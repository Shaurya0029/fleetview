import { useEffect, useRef, useState } from "react";
import { STATUS_ORDER, STATUS_STYLE } from "../palette";
import { trendSampler } from "../state/trendSampler";

type Preset = 60 | 300 | 900;
const PRESETS: { label: string; seconds: Preset }[] = [
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
  { label: "15m", seconds: 900 },
];

export function TrendChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const dragRef = useRef<{ startX: number; curX: number; active: boolean } | null>(null);
  const timeToXRef = useRef<(ts: number) => number>(() => 0);
  const xToTimeRef = useRef<(x: number) => number>(() => 0);

  const [preset, setPreset] = useState<Preset>(300);
  const [customRange, setCustomRange] = useState<{ from: number; to: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(container.clientWidth * dpr);
      canvas.height = Math.round(container.clientHeight * dpr);
      canvas.style.width = `${container.clientWidth}px`;
      canvas.style.height = `${container.clientHeight}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const all = trendSampler.getSamples();
      const now = Date.now();
      const range = customRange ?? { from: now - preset * 1000, to: now };
      const samples = all.filter((s) => s.ts >= range.from && s.ts <= range.to);

      const padL = 4;
      const padR = 4;
      const plotW = w - padL - padR;
      const timeToX = (ts: number) => padL + ((ts - range.from) / Math.max(1, range.to - range.from)) * plotW;
      const xToTime = (x: number) => range.from + ((x - padL) / plotW) * (range.to - range.from);
      timeToXRef.current = timeToX;
      xToTimeRef.current = xToTime;

      if (samples.length >= 1) {
        const step = plotW / samples.length;
        for (let i = 0; i < samples.length; i++) {
          const s = samples[i];
          const total = Math.max(1, s.total);
          let cum = 0;
          const x = timeToX(s.ts);
          const barW = Math.max(1, step + 1);
          for (const status of STATUS_ORDER) {
            const frac = s.counts[status] / total;
            if (frac <= 0) continue;
            const y0 = h - cum * h;
            const y1 = h - (cum + frac) * h;
            ctx.fillStyle = STATUS_STYLE[status].color;
            ctx.globalAlpha = 0.85;
            ctx.fillRect(x, y1, barW, y0 - y1);
            cum += frac;
          }
        }
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.font = "12px ui-monospace, monospace";
        ctx.fillText("collecting samples…", padL, h / 2);
      }

      const drag = dragRef.current;
      if (drag?.active) {
        const x0 = Math.min(drag.startX, drag.curX);
        const x1 = Math.max(drag.startX, drag.curX);
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.fillRect(x0, 0, x1 - x0, h);
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.strokeRect(x0, 0, x1 - x0, h);
      }

      ctx.restore();
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    const onPointerDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      dragRef.current = { startX: e.clientX - rect.left, curX: e.clientX - rect.left, active: true };
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragRef.current?.active) return;
      const rect = canvas.getBoundingClientRect();
      dragRef.current.curX = e.clientX - rect.left;
    };
    const onPointerUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      if (Math.abs(d.curX - d.startX) < 8) return; // treat as click, not a zoom drag
      const from = xToTimeRef.current(Math.min(d.startX, d.curX));
      const to = xToTimeRef.current(Math.max(d.startX, d.curX));
      setCustomRange({ from, to });
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
    };
  }, [preset, customRange]);

  return (
    <div className="trend-chart">
      <div className="trend-chart__toolbar">
        <span className="trend-chart__title">Fleet status composition</span>
        <div className="trend-chart__presets">
          {PRESETS.map((p) => (
            <button
              key={p.seconds}
              className={!customRange && preset === p.seconds ? "is-active" : ""}
              onClick={() => {
                setPreset(p.seconds);
                setCustomRange(null);
              }}
            >
              {p.label}
            </button>
          ))}
          {customRange && <button onClick={() => setCustomRange(null)}>Reset zoom</button>}
        </div>
        <div className="trend-chart__legend">
          {STATUS_ORDER.map((s) => (
            <span key={s} className="trend-chart__legend-item">
              <span className="dot" style={{ background: STATUS_STYLE[s].color }} />
              {STATUS_STYLE[s].label}
            </span>
          ))}
        </div>
      </div>
      <div className="trend-chart__canvas-wrap" ref={containerRef}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
