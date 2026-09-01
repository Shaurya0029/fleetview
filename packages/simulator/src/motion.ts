import {
  OBSTACLES,
  inflate,
  pointInAnyRect,
  segmentIntersectsAny,
  SITE_WIDTH,
  SITE_HEIGHT,
  type Rect,
} from "@waypoint/shared";

export interface Point {
  x: number;
  y: number;
}

const CLEARANCE = 14;
const INFLATED: Rect[] = inflate(OBSTACLES, CLEARANCE);
const EDGE_MARGIN = 4;

function clampToSite(p: Point): Point {
  return {
    x: Math.min(Math.max(p.x, EDGE_MARGIN), SITE_WIDTH - EDGE_MARGIN),
    y: Math.min(Math.max(p.y, EDGE_MARGIN), SITE_HEIGHT - EDGE_MARGIN),
  };
}

function pointInRectShrunk(p: Point, r: Rect, eps: number): boolean {
  return p.x >= r.x0 + eps && p.x <= r.x1 - eps && p.y >= r.y0 + eps && p.y <= r.y1 - eps;
}

// Nudge each corner node a hair outside the rectangle along its outward
// diagonal. Without this, a straight line between two corners of the SAME
// rectangle (e.g. its top-left to its top-right) runs exactly along that
// rectangle's own boundary, and the inclusive-bounds intersection test then
// (correctly, but unhelpfully) flags it as blocked by itself — splitting the
// visibility graph into disconnected left/right halves at every obstacle.
// Nudging the node just outside the corner keeps every other rect's
// blocking behavior intact (CLEARANCE is ~10x larger) while letting a robot
// path "around a corner" of the same rectangle.
const CORNER_NUDGE = 1.5;

function rectCorners(r: Rect): Point[] {
  return [
    { x: r.x0 - CORNER_NUDGE, y: r.y0 - CORNER_NUDGE },
    { x: r.x1 + CORNER_NUDGE, y: r.y0 - CORNER_NUDGE },
    { x: r.x0 - CORNER_NUDGE, y: r.y1 + CORNER_NUDGE },
    { x: r.x1 + CORNER_NUDGE, y: r.y1 + CORNER_NUDGE },
  ];
}

/**
 * Precomputed visibility-graph nodes: every inflated-obstacle corner that
 * isn't swallowed by a neighboring inflated obstacle, clamped to the site.
 * Built once at module load — obstacles are static for the whole run.
 */
const STATIC_NODES: Point[] = (() => {
  const nodes: Point[] = [];
  for (let i = 0; i < INFLATED.length; i++) {
    for (const raw of rectCorners(INFLATED[i])) {
      const c = clampToSite(raw);
      const swallowed = INFLATED.some((r, j) => j !== i && pointInRectShrunk(c, r, 0.5));
      if (!swallowed) nodes.push(c);
    }
  }
  return nodes;
})();

function visible(a: Point, b: Point): boolean {
  return !segmentIntersectsAny(a.x, a.y, b.x, b.y, INFLATED);
}

/** Static-to-static edges, precomputed once (obstacles never move). 0 means "no edge". */
const STATIC_EDGES: number[][] = STATIC_NODES.map(() => new Array(STATIC_NODES.length).fill(0));
for (let i = 0; i < STATIC_NODES.length; i++) {
  for (let j = i + 1; j < STATIC_NODES.length; j++) {
    if (visible(STATIC_NODES[i], STATIC_NODES[j])) {
      const d = dist(STATIC_NODES[i], STATIC_NODES[j]);
      STATIC_EDGES[i][j] = d;
      STATIC_EDGES[j][i] = d;
    }
  }
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Shortest collision-free path from `start` to `goal` around the 6 static
 * obstacle rectangles, via an incremental visibility graph: the static
 * corner-graph is precomputed once; each call only needs to wire `start`
 * and `goal` into it (O(N) segment checks) before running Dijkstra.
 * Returns waypoints EXCLUDING `start`, ending with `goal`.
 */
export function findPath(start: Point, goal: Point): Point[] {
  if (visible(start, goal)) return [goal];

  const nodes = [...STATIC_NODES, start, goal];
  const startIdx = nodes.length - 2;
  const goalIdx = nodes.length - 1;
  const n = nodes.length;

  const adj: number[][] = Array.from({ length: n }, () => new Array(n).fill(Infinity));
  for (let i = 0; i < STATIC_NODES.length; i++) {
    for (let j = 0; j < STATIC_NODES.length; j++) {
      if (i !== j && STATIC_EDGES[i][j] > 0) adj[i][j] = STATIC_EDGES[i][j];
    }
  }
  for (let i = 0; i < n; i++) {
    if (i === startIdx || i === goalIdx) continue;
    if (visible(nodes[startIdx], nodes[i])) {
      const d = dist(nodes[startIdx], nodes[i]);
      adj[startIdx][i] = d;
      adj[i][startIdx] = d;
    }
    if (visible(nodes[goalIdx], nodes[i])) {
      const d = dist(nodes[goalIdx], nodes[i]);
      adj[goalIdx][i] = d;
      adj[i][goalIdx] = d;
    }
  }
  if (visible(nodes[startIdx], nodes[goalIdx])) {
    const d = dist(nodes[startIdx], nodes[goalIdx]);
    adj[startIdx][goalIdx] = d;
    adj[goalIdx][startIdx] = d;
  }

  // Dijkstra
  const distTo = new Array(n).fill(Infinity);
  const prev = new Array(n).fill(-1);
  const visited = new Array(n).fill(false);
  distTo[startIdx] = 0;

  for (let iter = 0; iter < n; iter++) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      if (!visited[i] && distTo[i] < best) {
        best = distTo[i];
        u = i;
      }
    }
    if (u === -1) break;
    visited[u] = true;
    if (u === goalIdx) break;
    for (let v = 0; v < n; v++) {
      if (adj[u][v] === Infinity) continue;
      const alt = distTo[u] + adj[u][v];
      if (alt < distTo[v]) {
        distTo[v] = alt;
        prev[v] = u;
      }
    }
  }

  if (distTo[goalIdx] === Infinity) {
    // Disconnected (shouldn't happen given the site is open) — fall back to
    // a direct line rather than freezing the robot.
    return [goal];
  }

  const path: Point[] = [];
  let cur = goalIdx;
  while (cur !== -1 && cur !== startIdx) {
    path.unshift(nodes[cur]);
    cur = prev[cur];
  }
  return path;
}

export function randomPointInBounds(rand: () => number = Math.random): Point {
  for (let attempt = 0; attempt < 40; attempt++) {
    const p = { x: EDGE_MARGIN + rand() * (SITE_WIDTH - 2 * EDGE_MARGIN), y: EDGE_MARGIN + rand() * (SITE_HEIGHT - 2 * EDGE_MARGIN) };
    if (!pointInAnyRect(p.x, p.y, INFLATED)) return p;
  }
  return { x: SITE_WIDTH / 2, y: SITE_HEIGHT / 2 };
}

function pointNearObstaclePerimeter(rand: () => number): Point {
  const rect = OBSTACLES[Math.floor(rand() * OBSTACLES.length)];
  const off = 18 + rand() * 45;
  const side = Math.floor(rand() * 4);
  let p: Point;
  switch (side) {
    case 0:
      p = { x: rect.x0 + rand() * (rect.x1 - rect.x0), y: rect.y0 - off };
      break;
    case 1:
      p = { x: rect.x0 + rand() * (rect.x1 - rect.x0), y: rect.y1 + off };
      break;
    case 2:
      p = { x: rect.x0 - off, y: rect.y0 + rand() * (rect.y1 - rect.y0) };
      break;
    default:
      p = { x: rect.x1 + off, y: rect.y0 + rand() * (rect.y1 - rect.y0) };
  }
  return clampToSite(p);
}

/**
 * Picks the next waypoint target given robot type (PRD §3 decision):
 * pickers hop short distances, concentrated near shelving rows; haulers
 * make long runs across the open floor.
 */
export function pickTarget(
  type: "picker" | "hauler",
  from: Point,
  rand: () => number = Math.random
): Point {
  const wantShort = type === "picker";
  let best: Point | null = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < 15; attempt++) {
    const candidate =
      type === "picker" && rand() < 0.7 ? pointNearObstaclePerimeter(rand) : randomPointInBounds(rand);
    if (pointInAnyRect(candidate.x, candidate.y, INFLATED)) continue;
    const d = dist(from, candidate);
    const ok = wantShort ? d >= 30 && d <= 160 : d >= 260;
    if (ok) return candidate;
    // keep the best-effort candidate in case nothing satisfies the distance band
    const score = wantShort ? -Math.abs(d - 90) : d;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best ?? randomPointInBounds(rand);
}

export const CHARGING_DOCK: Point = { x: 25, y: 525 };

export interface MotionState {
  pos: Point;
  path: Point[]; // remaining waypoints, path[path.length-1] is the final target
}

/** Advances `state` up to `maxDistance` along its current path, consuming waypoints as reached. */
export function advanceAlongPath(state: MotionState, maxDistance: number): void {
  let budget = maxDistance;
  let guard = 0;
  while (budget > 0 && state.path.length > 0 && guard++ < 8) {
    const next = state.path[0];
    const d = dist(state.pos, next);
    if (d <= budget) {
      state.pos = next;
      state.path.shift();
      budget -= d;
    } else {
      const t = budget / d;
      state.pos = { x: state.pos.x + (next.x - state.pos.x) * t, y: state.pos.y + (next.y - state.pos.y) * t };
      budget = 0;
    }
  }
}
