import {
  UpsertBoneKeyframe,
  type SpineBoneKey,
  type SpineBoneTimelineName,
} from '@spine-editor/core';
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/store.js';

const PAD_L = 44;
const PAD_R = 16;
const PAD_T = 12;
const PAD_B = 18;
const HEIGHT = 150;
const CHANNEL_COLORS = ['#e0836c', '#7fb2e5'];

function cubic(a: number, b: number, c: number, d: number, t: number): number {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

function channelValues(tl: SpineBoneTimelineName, key: SpineBoneKey): number[] {
  const dflt = tl.startsWith('scale') ? 1 : 0;
  if (tl === 'translate' || tl === 'scale' || tl === 'shear') {
    return [key.x ?? dflt, key.y ?? dflt];
  }
  return [key.value ?? dflt];
}

interface Handle {
  channel: number;
  /** 0 = outgoing handle at k1, 1 = incoming handle at k2. */
  end: 0 | 1;
}

/**
 * Bezier curve editor for the segment between the selected bone key and the
 * next key on the same timeline. Dragging the handles writes the Spine curve
 * array (absolute time/value control points, one block per channel).
 */
export function GraphEditor({
  animation,
  bone,
  timeline,
  time,
}: {
  animation: string;
  bone: string;
  timeline: SpineBoneTimelineName;
  time: number;
}) {
  const revision = useEditor((s) => s.revision);
  const doc = useEditor((s) => s.doc);
  void revision;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<Handle | null>(null);
  const [override, setOverride] = useState<number[] | null>(null);
  const [width, setWidth] = useState(600);

  const keys = doc.getAnimation(animation)?.bones?.[bone]?.[timeline];
  const idx = keys?.findIndex((k) => Math.abs((k.time ?? 0) - time) < 1e-6) ?? -1;
  const k1 = keys?.[idx];
  const k2 = keys?.[idx + 1];

  // Reset any in-progress drag state when the selected segment changes.
  useEffect(() => setOverride(null), [animation, bone, timeline, time]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => setWidth(Math.max(240, host.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const segment = (() => {
    if (!k1 || !k2) return null;
    const t1 = k1.time ?? 0;
    const t2 = k2.time ?? 0;
    if (t2 - t1 <= 0) return null;
    const v1s = channelValues(timeline, k1);
    const v2s = channelValues(timeline, k2);
    const stepped = k1.curve === 'stepped';
    const base = Array.isArray(k1.curve) ? k1.curve : null;
    // Full curve array over all channels, defaulting to linear thirds.
    const curve =
      override ??
      v1s
        .map((v1, ch) => {
          const v2 = v2s[ch] ?? v1;
          const o = ch * 4;
          return [
            base?.[o] ?? t1 + (t2 - t1) / 3,
            base?.[o + 1] ?? v1 + (v2 - v1) / 3,
            base?.[o + 2] ?? t1 + ((t2 - t1) * 2) / 3,
            base?.[o + 3] ?? v1 + ((v2 - v1) * 2) / 3,
          ];
        })
        .flat();
    return { t1, t2, v1s, v2s, curve, stepped };
  })();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !segment) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = HEIGHT * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);

    const { t1, t2, v1s, v2s, curve } = segment;
    const allValues = v1s.flatMap((v1, ch) => [
      v1,
      v2s[ch] ?? v1,
      curve[ch * 4 + 1] ?? v1,
      curve[ch * 4 + 3] ?? v1,
    ]);
    let vmin = Math.min(...allValues);
    let vmax = Math.max(...allValues);
    if (vmax - vmin < 1e-6) {
      vmin -= 1;
      vmax += 1;
    }
    const tx = (t: number) => PAD_L + ((t - t1) / (t2 - t1)) * (width - PAD_L - PAD_R);
    const vy = (v: number) =>
      HEIGHT - PAD_B - ((v - vmin) / (vmax - vmin)) * (HEIGHT - PAD_T - PAD_B);

    // Grid + labels.
    ctx.strokeStyle = '#2c2c31';
    ctx.fillStyle = '#77777f';
    ctx.font = '10px system-ui';
    ctx.lineWidth = 1;
    for (const v of [vmin, (vmin + vmax) / 2, vmax]) {
      ctx.beginPath();
      ctx.moveTo(PAD_L, vy(v));
      ctx.lineTo(width - PAD_R, vy(v));
      ctx.stroke();
      ctx.fillText(v.toFixed(1), 4, vy(v) + 3);
    }
    ctx.fillText(`${t1.toFixed(2)}s`, PAD_L, HEIGHT - 5);
    ctx.fillText(`${t2.toFixed(2)}s`, width - PAD_R - 30, HEIGHT - 5);

    v1s.forEach((v1, ch) => {
      const v2 = v2s[ch] ?? v1;
      const o = ch * 4;
      const [cx1, cy1, cx2, cy2] = [curve[o]!, curve[o + 1]!, curve[o + 2]!, curve[o + 3]!];
      const color = CHANNEL_COLORS[ch % CHANNEL_COLORS.length]!;

      // Curve.
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 48; i++) {
        const u = i / 48;
        const x = tx(cubic(t1, cx1, cx2, t2, u));
        const y = vy(cubic(v1, cy1, cy2, v2, u));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Handle stems + knobs + anchors.
      ctx.lineWidth = 1;
      ctx.strokeStyle = color;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(tx(t1), vy(v1));
      ctx.lineTo(tx(cx1), vy(cy1));
      ctx.moveTo(tx(t2), vy(v2));
      ctx.lineTo(tx(cx2), vy(cy2));
      ctx.stroke();
      ctx.setLineDash([]);
      for (const [hx, hy] of [
        [cx1, cy1],
        [cx2, cy2],
      ] as const) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(tx(hx), vy(hy), 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ffcc33';
      for (const [ax, ay] of [
        [t1, v1],
        [t2, v2],
      ] as const) {
        ctx.beginPath();
        ctx.arc(tx(ax), vy(ay), 4, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }, [segment, width]);

  if (!k1) return null;
  if (!k2 || !segment) {
    return (
      <div className="graph-editor empty">
        Select a key that has a following key on the same timeline to edit its curve.
      </div>
    );
  }
  if (segment.stepped) {
    return <div className="graph-editor empty">Stepped key — no bezier curve to edit.</div>;
  }

  function pointFromEvent(e: React.PointerEvent): { t: number; v: number } {
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const { t1, t2, v1s, v2s, curve } = segment!;
    const allValues = v1s.flatMap((v1, ch) => [
      v1,
      v2s[ch] ?? v1,
      curve[ch * 4 + 1] ?? v1,
      curve[ch * 4 + 3] ?? v1,
    ]);
    let vmin = Math.min(...allValues);
    let vmax = Math.max(...allValues);
    if (vmax - vmin < 1e-6) {
      vmin -= 1;
      vmax += 1;
    }
    const t = t1 + ((px - PAD_L) / (width - PAD_L - PAD_R)) * (t2 - t1);
    const v = vmin + ((HEIGHT - PAD_B - py) / (HEIGHT - PAD_T - PAD_B)) * (vmax - vmin);
    return { t, v };
  }

  function onPointerDown(e: React.PointerEvent) {
    const { t, v } = pointFromEvent(e);
    const { t1, t2, curve, v1s, v2s } = segment!;
    // Nearest handle in normalized space.
    let best: Handle | null = null;
    let bestDist = Infinity;
    const allValues = v1s.flatMap((v1, ch) => [v1, v2s[ch] ?? v1]);
    const span = Math.max(...allValues) - Math.min(...allValues) || 2;
    v1s.forEach((_, ch) => {
      const o = ch * 4;
      const handles: [number, number, 0 | 1][] = [
        [curve[o]!, curve[o + 1]!, 0],
        [curve[o + 2]!, curve[o + 3]!, 1],
      ];
      for (const [hx, hy, end] of handles) {
        const d = Math.hypot((hx - t) / (t2 - t1), (hy - v) / span);
        if (d < bestDist) {
          bestDist = d;
          best = { channel: ch, end };
        }
      }
    });
    if (!best || bestDist > 0.12) return;
    dragRef.current = best;
    setOverride([...segment!.curve]);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag || !override) return;
    const { t, v } = pointFromEvent(e);
    const { t1, t2 } = segment!;
    const next = [...override];
    const o = drag.channel * 4 + drag.end * 2;
    next[o] = Math.min(t2, Math.max(t1, t));
    next[o + 1] = v;
    setOverride(next);
  }

  function onPointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !override || !k1) return;
    const rounded = override.map((v) => Math.round(v * 1000) / 1000);
    useEditor
      .getState()
      .execute(new UpsertBoneKeyframe(animation, bone, timeline, { ...k1, curve: rounded }));
    setOverride(null);
  }

  return (
    <div className="graph-editor" ref={hostRef}>
      <div className="graph-toolbar">
        <span className="graph-title">
          {bone} · {timeline} @ {time.toFixed(2)}s
        </span>
        {timeline === 'translate' || timeline === 'scale' || timeline === 'shear' ? (
          <span className="graph-legend">
            <i style={{ background: CHANNEL_COLORS[0] }} /> x
            <i style={{ background: CHANNEL_COLORS[1] }} /> y
          </span>
        ) : null}
        <button
          onClick={() => {
            const key = { ...k1 };
            delete key.curve;
            useEditor.getState().execute(new UpsertBoneKeyframe(animation, bone, timeline, key));
            setOverride(null);
          }}
        >
          Reset linear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: HEIGHT }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
    </div>
  );
}
