import { useEffect, useRef, useState } from 'react';
import { audioEngine } from '../audio/engine.js';

/** Waveform strip for one event key's audio, starting at the key's x. */
export function EventWave({
  name,
  left,
  pxPerSecond,
  height,
  maxWidth,
}: {
  name: string;
  left: number;
  pxPerSecond: number;
  height: number;
  maxWidth: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [, force] = useState(0);
  useEffect(() => audioEngine.onDecoded(() => force((v) => v + 1)), []);

  const duration = audioEngine.duration(name);
  const width = duration ? Math.max(2, Math.min(duration * pxPerSecond, maxWidth)) : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const buckets = Math.max(1, Math.floor(width));
    const peaks = audioEngine.peaks(name, buckets);
    const g = canvas.getContext('2d');
    if (!peaks || !g) return;
    canvas.width = buckets;
    canvas.height = height;
    g.clearRect(0, 0, buckets, height);
    g.fillStyle = 'rgba(56, 117, 183, 0.55)'; // --accent, translucent
    const mid = height / 2;
    for (let x = 0; x < buckets; x++) {
      const h = Math.max(1, peaks[x]! * (height - 2));
      g.fillRect(x, mid - h / 2, 1, h);
    }
  }, [name, width, height]);

  if (width <= 0) return null;
  return <canvas ref={canvasRef} className="wave" style={{ left, width, height }} />;
}
