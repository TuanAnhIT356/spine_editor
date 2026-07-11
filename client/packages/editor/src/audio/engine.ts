/**
 * Editor-only audio engine (Web Audio): decodes audio-asset data URLs into
 * cached AudioBuffers, serves per-bucket peak amplitudes for dopesheet waveforms, and
 * plays event sounds through gain (volume) + stereo panner (balance).
 * The AudioContext is created lazily (autoplay policy: first use follows a
 * user gesture — Play button, scrub drag, or the preview ▶).
 */

interface PlayOpts {
  volume?: number;
  balance?: number;
  rate?: number;
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private decoding = new Set<string>();
  private urls = new Map<string, string>();
  private peaksCache = new Map<string, Float32Array>();
  private playing = new Set<AudioBufferSourceNode>();
  private subscribers = new Set<() => void>();
  private muted = false;

  private context(): AudioContext {
    this.ctx ??= new AudioContext();
    return this.ctx;
  }

  /** Decode (once) so duration/peaks become available; notifies subscribers. */
  ensure(name: string, dataUrl: string): void {
    const known = this.urls.get(name);
    if (known === dataUrl && (this.buffers.has(name) || this.decoding.has(name))) return;
    // Same name, new content (re-import / other project): drop the stale decode.
    if (known !== undefined && known !== dataUrl) this.remove(name);
    this.urls.set(name, dataUrl);
    this.decoding.add(name);
    void (async () => {
      try {
        const res = await fetch(dataUrl);
        const bytes = await res.arrayBuffer();
        const buffer = await this.context().decodeAudioData(bytes);
        if (this.urls.get(name) !== dataUrl) return; // superseded while decoding
        this.buffers.set(name, buffer);
        for (const cb of this.subscribers) cb();
      } catch {
        // Undecodable codec: keep the asset (export still references the
        // file name); waveform/preview simply stay unavailable.
        console.warn(`Cannot decode audio "${name}".`);
      } finally {
        this.decoding.delete(name);
      }
    })();
  }

  duration(name: string): number | null {
    return this.buffers.get(name)?.duration ?? null;
  }

  /** Mono max-|sample| per bucket, cached per (name, buckets). */
  peaks(name: string, buckets: number): Float32Array | null {
    const buffer = this.buffers.get(name);
    if (!buffer || buckets <= 0) return null;
    const key = `${name}#${buckets}`;
    const cached = this.peaksCache.get(key);
    if (cached) return cached;
    const out = new Float32Array(buckets);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) =>
      buffer.getChannelData(c),
    );
    const per = buffer.length / buckets;
    for (let b = 0; b < buckets; b++) {
      const from = Math.floor(b * per);
      const to = Math.min(buffer.length, Math.ceil((b + 1) * per));
      let max = 0;
      for (const data of channels) {
        for (let i = from; i < to; i++) {
          const v = Math.abs(data[i] ?? 0);
          if (v > max) max = v;
        }
      }
      out[b] = max;
    }
    this.peaksCache.set(key, out);
    return out;
  }

  play(name: string, opts: PlayOpts = {}): void {
    if (this.muted) return;
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    const ctx = this.context();
    void ctx.resume();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = Math.max(0.1, opts.rate ?? 1);
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, opts.volume ?? 1);
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, opts.balance ?? 0));
    source.connect(gain).connect(panner).connect(ctx.destination);
    this.playing.add(source);
    source.onended = () => {
      this.playing.delete(source);
    };
    source.start();
  }

  stopAll(): void {
    for (const source of this.playing) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
    this.playing.clear();
  }

  remove(name: string): void {
    this.buffers.delete(name);
    this.urls.delete(name);
    for (const key of this.peaksCache.keys()) {
      if (key.startsWith(`${name}#`)) this.peaksCache.delete(key);
    }
  }

  /** Drops cached audio for any name not in `names` (store reconciliation). */
  retain(names: readonly string[]): void {
    const keep = new Set(names);
    for (const name of [...this.buffers.keys()]) {
      if (!keep.has(name)) this.remove(name);
    }
    for (const name of [...this.urls.keys()]) {
      if (!keep.has(name)) this.urls.delete(name);
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (m) this.stopAll();
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** Re-render hook for components drawing waveforms. */
  onDecoded(cb: () => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }
}

export const audioEngine = new AudioEngine();
