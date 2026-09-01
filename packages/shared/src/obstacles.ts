/**
 * Static obstacle rectangles for the 900x560 site (layout.png), in {x0,y0,x1,y1}
 * top-left/bottom-right form. Must stay in sync with data/gen_layout.py.
 */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const SITE_WIDTH = 900;
export const SITE_HEIGHT = 560;

export const OBSTACLES: Rect[] = [
  { x0: 150, y0: 80, x1: 340, y1: 140 },
  { x0: 150, y0: 220, x1: 340, y1: 280 },
  { x0: 150, y0: 360, x1: 340, y1: 420 },
  { x0: 500, y0: 60, x1: 565, y1: 460 },
  { x0: 650, y0: 150, x1: 850, y1: 210 },
  { x0: 650, y0: 335, x1: 850, y1: 395 },
];

/** Inflate each rectangle by a margin so path planning keeps a clearance gap. */
export function inflate(rects: Rect[], margin: number): Rect[] {
  return rects.map((r) => ({
    x0: r.x0 - margin,
    y0: r.y0 - margin,
    x1: r.x1 + margin,
    y1: r.y1 + margin,
  }));
}

export function pointInRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

export function pointInAnyRect(x: number, y: number, rects: Rect[]): boolean {
  return rects.some((r) => pointInRect(x, y, r));
}

/** Does the open segment a->b cross rectangle r? Simple slab test. */
export function segmentIntersectsRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: Rect
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  let tMin = 0;
  let tMax = 1;

  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > tMax) return false;
      if (t > tMin) tMin = t;
    } else {
      if (t < tMin) return false;
      if (t < tMax) tMax = t;
    }
    return true;
  };

  if (
    clip(-dx, ax - r.x0) &&
    clip(dx, r.x1 - ax) &&
    clip(-dy, ay - r.y0) &&
    clip(dy, r.y1 - ay)
  ) {
    return tMin < tMax;
  }
  return false;
}

export function segmentIntersectsAny(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  rects: Rect[]
): boolean {
  return rects.some((r) => segmentIntersectsRect(ax, ay, bx, by, r));
}
