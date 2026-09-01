import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RobotRosterEntry, RobotType } from "@waypoint/shared";
import { randomPointInBounds } from "./motion.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FALLBACK_ROSTER: RobotRosterEntry[] = [
  { robot_id: "r1", robot_type: "picker", start: { x: 569.9, y: 33.0 } },
  { robot_id: "r2", robot_type: "hauler", start: { x: 787.3, y: 65.2 } },
  { robot_id: "r3", robot_type: "picker", start: { x: 100.0, y: 460.0 } },
  { robot_id: "r4", robot_type: "hauler", start: { x: 420.0, y: 500.0 } },
  { robot_id: "r5", robot_type: "picker", start: { x: 300.0, y: 40.0 } },
  { robot_id: "r6", robot_type: "hauler", start: { x: 620.0, y: 480.0 } },
  { robot_id: "r7", robot_type: "picker", start: { x: 40.0, y: 200.0 } },
  { robot_id: "r8", robot_type: "hauler", start: { x: 870.0, y: 300.0 } },
];

function loadBaseRoster(): RobotRosterEntry[] {
  const candidates = [
    path.join(__dirname, "..", "..", "..", "data", "robots.json"),
    path.join(process.cwd(), "data", "robots.json"),
  ];
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, "utf-8");
      const parsed = JSON.parse(raw) as RobotRosterEntry[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // try next candidate
    }
  }
  return FALLBACK_ROSTER;
}

const BASE_ROSTER = loadBaseRoster();

/**
 * Builds a roster of exactly `size` robots. Reuses the given 8-robot roster
 * as a starting point (PRD §2.2: "starting point, not a ceiling") and
 * extends the same `rN` / alternating-type pattern for any size beyond it,
 * inventing a random valid (obstacle-free) start position for each new one.
 */
export function buildRoster(size: number): RobotRosterEntry[] {
  const roster: RobotRosterEntry[] = [];
  for (let i = 0; i < size; i++) {
    if (i < BASE_ROSTER.length) {
      roster.push(BASE_ROSTER[i]);
      continue;
    }
    const n = i + 1;
    const type: RobotType = n % 2 === 1 ? "picker" : "hauler";
    const start = randomPointInBounds();
    roster.push({ robot_id: `r${n}`, robot_type: type, start });
  }
  return roster;
}
