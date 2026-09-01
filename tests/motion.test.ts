import { describe, expect, it } from "vitest";
import { OBSTACLES, segmentIntersectsAny } from "../packages/shared/src/obstacles.js";
import { findPath, pickTarget, type Point } from "../packages/simulator/src/motion.js";

function pathCrossesAnyObstacle(start: Point, waypoints: Point[]): boolean {
  let prev = start;
  for (const wp of waypoints) {
    if (segmentIntersectsAny(prev.x, prev.y, wp.x, wp.y, OBSTACLES)) return true;
    prev = wp;
  }
  return false;
}

const CASES: { start: Point; goal: Point }[] = [
  { start: { x: 50, y: 100 }, goal: { x: 800, y: 100 } }, // straight across, through the left racks
  { start: { x: 400, y: 300 }, goal: { x: 700, y: 300 } }, // through the central rack
  { start: { x: 10, y: 10 }, goal: { x: 890, y: 550 } }, // corner to corner, through everything
  { start: { x: 750, y: 100 }, goal: { x: 750, y: 450 } }, // top to bottom, through both right-side racks
  { start: { x: 200, y: 50 }, goal: { x: 200, y: 450 } }, // straight down through all three left racks
];

describe("findPath", () => {
  for (const { start, goal } of CASES) {
    it(`routes around obstacles from (${start.x},${start.y}) to (${goal.x},${goal.y})`, () => {
      const path = findPath(start, goal);
      expect(path.length).toBeGreaterThan(0);
      expect(path[path.length - 1]).toEqual(goal);
      expect(pathCrossesAnyObstacle(start, path)).toBe(false);
    });
  }

  it("returns a direct one-hop path when there is clear line of sight", () => {
    const path = findPath({ x: 10, y: 10 }, { x: 60, y: 10 });
    expect(path).toEqual([{ x: 60, y: 10 }]);
  });
});

describe("pickTarget", () => {
  // A constant rand() would make every rejection-sampling attempt inside
  // pickTarget draw the identical candidate, which defeats the retry loop —
  // use a varying seeded PRNG instead, same as the status-machine tests.
  function seededRand(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return (s % 10000) / 10000;
    };
  }

  it("keeps picker hops short", () => {
    const from: Point = { x: 450, y: 300 };
    for (let seed = 0; seed < 20; seed++) {
      const target = pickTarget("picker", from, seededRand(seed + 1));
      const d = Math.hypot(target.x - from.x, target.y - from.y);
      expect(d).toBeLessThan(220); // generous upper bound above the 160px target band
    }
  });

  it("keeps hauler runs long", () => {
    const from: Point = { x: 450, y: 300 };
    for (let seed = 0; seed < 20; seed++) {
      const target = pickTarget("hauler", from, seededRand(seed + 1));
      const d = Math.hypot(target.x - from.x, target.y - from.y);
      expect(d).toBeGreaterThan(150); // generous lower bound below the 260px target band
    }
  });
});
