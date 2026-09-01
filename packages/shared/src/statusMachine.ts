import type { RobotStatus } from "./types.js";

/**
 * Legal status transitions a robot may make on its own. `offline` is never a
 * source or destination here — it is assigned only by the backend's staleness
 * sweep (see §3 of the PRD), and a reconnecting robot resumes from whatever
 * status it announces next (idle/active/etc), never announcing "offline" itself.
 *
 * Key rule enforced here: `error` cannot go straight to `on_mission` or `active`;
 * it must resolve through `maintenance` or `idle` first.
 */
export const LEGAL_TRANSITIONS: Record<RobotStatus, RobotStatus[]> = {
  idle: ["active", "on_mission", "charging", "maintenance", "error"],
  active: ["idle", "on_mission", "blocked", "error", "charging"],
  on_mission: ["active", "idle", "blocked", "error", "charging"],
  charging: ["idle", "active"],
  blocked: ["active", "on_mission", "idle", "error"],
  error: ["maintenance", "idle"],
  maintenance: ["idle", "active"],
  offline: ["idle", "active", "charging"],
};

export function isLegalTransition(from: RobotStatus, to: RobotStatus): boolean {
  if (from === to) return true;
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Rough expected dwell time in seconds per status, used to pace transitions
 * plausibly (from observing events.jsonl-shaped data) and to decide when a
 * robot is "stuck" in maintenance longer than expected. */
export const EXPECTED_DWELL_SECONDS: Record<RobotStatus, number> = {
  idle: 25,
  active: 40,
  on_mission: 90,
  charging: 180,
  blocked: 20,
  error: 30,
  maintenance: 60,
  offline: 0,
};
