import { useEffect, useRef, useState } from "react";
import { SITE_WIDTH, SITE_HEIGHT } from "@waypoint/shared";
import { fleetStore } from "../state/fleetStore";
import { STATUS_STYLE } from "../palette";

interface View {
  zoom: number;
  panX: number;
  panY: number;
}

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 8;
const DOT_RADIUS = 4.2;
const SMOOTHING = 0.12; // exponential position smoothing per frame, so robots glide rather than snap to each new report

// Congestion heatmap: a coarse occupancy grid over the site, accumulated in
// real seconds-spent-per-cell (not a one-shot histogram) with an exponential
// decay so the overlay reflects recent traffic, not the whole session's
// history. Reuses the live positions already being rendered -- no new
// backend surface or stored history needed.
const HEAT_CELL = 12; // px per grid cell
const HEAT_COLS = Math.ceil(SITE_WIDTH / HEAT_CELL);
const HEAT_ROWS = Math.ceil(SITE_HEIGHT / HEAT_CELL);
const HEAT_HALF_LIFE_SEC = 90;
const HEAT_DECAY_PER_SEC = Math.log(2) / HEAT_HALF_LIFE_SEC;

export function SiteView({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string | null) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const viewRef = useRef<View>({ zoom: 1, panX: 0, panY: 0 });
  const renderedPos = useRef<Map<string, { x: number; y: number }>>(new Map());
  const rafRef = useRef<number>(0);
  const draggingRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number; moved: boolean } | null>(
    null
  );
  const heatGridRef = useRef<Float32Array>(new Float32Array(HEAT_COLS * HEAT_ROWS));
  const lastFrameRef = useRef<number>(0);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const showHeatmapRef = useRef(showHeatmap);
  showHeatmapRef.current = showHeatmap;

  useEffect(() => {
    const img = new Image();
    img.src = "/layout.png";
    imgRef.current = img;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth;
      const h = container.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const baseFit = (w: number, h: number) => Math.min(w / SITE_WIDTH, h / SITE_HEIGHT) * 0.94;

    const geometry = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const scale = baseFit(w, h) * viewRef.current.zoom;
      const originX = w / 2 - (SITE_WIDTH * scale) / 2 + viewRef.current.panX;
      const originY = h / 2 - (SITE_HEIGHT * scale) / 2 + viewRef.current.panY;
      return { w, h, scale, originX, originY, dpr };
    };

    const screenToWorld = (sx: number, sy: number) => {
      const { scale, originX, originY } = geometry();
      return { x: (sx - originX) / scale, y: (sy - originY) / scale };
    };

    const draw = () => {
      const { w, h, scale, originX, originY, dpr } = geometry();
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#0b0e14";
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.translate(originX, originY);
      ctx.scale(scale, scale);

      const img = imgRef.current;
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, 0, 0, SITE_WIDTH, SITE_HEIGHT);
      } else {
        ctx.fillStyle = "#161b26";
        ctx.fillRect(0, 0, SITE_WIDTH, SITE_HEIGHT);
      }

      const now = performance.now();
      const pulse = 0.5 + 0.5 * Math.sin(now / 350);
      const dt = lastFrameRef.current ? Math.min(0.25, (now - lastFrameRef.current) / 1000) : 0;
      lastFrameRef.current = now;

      // Pass 1: advance smoothed positions and accrue heat. Always runs
      // (even while the overlay is hidden) so toggling it on shows real
      // recent congestion instead of a blank grid that only just started counting.
      const grid = heatGridRef.current;
      const decay = Math.exp(-HEAT_DECAY_PER_SEC * dt);
      for (let i = 0; i < grid.length; i++) grid[i] *= decay;

      for (const robot of fleetStore.robots.values()) {
        let rp = renderedPos.current.get(robot.robot_id);
        if (!rp) {
          rp = { x: robot.x, y: robot.y };
          renderedPos.current.set(robot.robot_id, rp);
        } else {
          rp.x += (robot.x - rp.x) * SMOOTHING;
          rp.y += (robot.y - rp.y) * SMOOTHING;
        }

        if (dt > 0) {
          const gx = Math.min(HEAT_COLS - 1, Math.max(0, Math.floor(rp.x / HEAT_CELL)));
          const gy = Math.min(HEAT_ROWS - 1, Math.max(0, Math.floor(rp.y / HEAT_CELL)));
          grid[gy * HEAT_COLS + gx] += dt;
        }
      }

      if (showHeatmapRef.current) {
        for (let gy = 0; gy < HEAT_ROWS; gy++) {
          for (let gx = 0; gx < HEAT_COLS; gx++) {
            const v = grid[gy * HEAT_COLS + gx];
            if (v < 0.05) continue;
            // sqrt compression: a few very hot cells shouldn't wash out everything else
            const alpha = Math.min(0.75, Math.sqrt(v) * 0.09);
            ctx.fillStyle = `rgba(255, 120, 40, ${alpha})`;
            ctx.fillRect(gx * HEAT_CELL, gy * HEAT_CELL, HEAT_CELL, HEAT_CELL);
          }
        }
      }

      // Pass 2: draw robots on top of the heat layer, so congestion never obscures the fleet itself.
      for (const robot of fleetStore.robots.values()) {
        const rp = renderedPos.current.get(robot.robot_id)!;
        const style = STATUS_STYLE[robot.status];
        const r = DOT_RADIUS / Math.sqrt(scale); // keep dots a sane on-screen size across zoom levels

        if (robot.needs_attention) {
          ctx.beginPath();
          ctx.arc(rp.x, rp.y, r + 3 + pulse * 2, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,255,255,${0.25 + pulse * 0.35})`;
          ctx.lineWidth = 1.4 / scale;
          ctx.stroke();
        }

        if (robot.robot_id === selectedId) {
          ctx.beginPath();
          ctx.arc(rp.x, rp.y, r + 5, 0, Math.PI * 2);
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.8 / scale;
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(rp.x, rp.y, r, 0, Math.PI * 2);
        ctx.fillStyle = style.color;
        ctx.fill();

        if (robot.robot_type === "hauler") {
          ctx.beginPath();
          ctx.rect(rp.x - r * 0.35, rp.y - r * 0.35, r * 0.7, r * 0.7);
          ctx.fillStyle = "rgba(0,0,0,0.35)";
          ctx.fill();
        }
      }

      // prune stale interpolation entries for robots no longer present
      if (renderedPos.current.size > fleetStore.robots.size) {
        for (const id of renderedPos.current.keys()) {
          if (!fleetStore.robots.has(id)) renderedPos.current.delete(id);
        }
      }

      ctx.restore();
      ctx.restore();
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const before = screenToWorld(sx, sy);
      const factor = Math.exp(-e.deltaY * 0.0015);
      viewRef.current.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewRef.current.zoom * factor));
      const { scale, originX, originY } = geometry();
      // keep the point under the cursor fixed after zooming
      viewRef.current.panX += sx - (originX + before.x * scale);
      viewRef.current.panY += sy - (originY + before.y * scale);
    };

    const onPointerDown = (e: PointerEvent) => {
      draggingRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startPanX: viewRef.current.panX,
        startPanY: viewRef.current.panY,
        moved: false,
      };
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      const d = draggingRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
      viewRef.current.panX = d.startPanX + dx;
      viewRef.current.panY = d.startPanY + dy;
    };
    const onPointerUp = (e: PointerEvent) => {
      const d = draggingRef.current;
      draggingRef.current = null;
      if (!d || d.moved) return;

      const rect = canvas.getBoundingClientRect();
      const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      const { scale } = geometry();
      const hitRadiusWorld = 14 / scale;
      let closestId: string | null = null;
      let closestDist = hitRadiusWorld;
      for (const robot of fleetStore.robots.values()) {
        const rp = renderedPos.current.get(robot.robot_id) ?? { x: robot.x, y: robot.y };
        const dist = Math.hypot(rp.x - world.x, rp.y - world.y);
        if (dist < closestDist) {
          closestDist = dist;
          closestId = robot.robot_id;
        }
      }
      onSelect(closestId);
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, onSelect]);

  const resetView = () => {
    viewRef.current = { zoom: 1, panX: 0, panY: 0 };
  };

  return (
    <div className="site-view" ref={containerRef}>
      <canvas ref={canvasRef} title="Scroll to zoom, drag to pan, click a robot to see its details" />
      <div className="site-view__controls">
        <button
          className={showHeatmap ? "is-active" : ""}
          onClick={() => setShowHeatmap((v) => !v)}
          title="Show where robots have spent the most time recently -- a fast way to spot floor congestion"
        >
          Congestion
        </button>
        <button onClick={resetView} title="Reset pan/zoom">
          Reset view
        </button>
      </div>
    </div>
  );
}
