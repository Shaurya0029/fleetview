import { EXPECTED_DWELL_SECONDS } from "./statusMachine.js";
import type { RobotStatus } from "./types.js";

export const LOW_BATTERY_THRESHOLD = 15;
export const MAINTENANCE_STUCK_MULTIPLIER = 1.5;

export interface AttentionInput {
  status: RobotStatus;
  battery: number;
  /** seconds spent continuously in the current status */
  statusDwellSeconds: number;
}

/**
 * Implements the "needs attention" decision from PRD §3: always for
 * error/blocked/offline; low battery while not charging; maintenance only
 * if stuck past its expected duration.
 */
export function computeAttention(input: AttentionInput): string[] {
  const reasons: string[] = [];
  const { status, battery, statusDwellSeconds } = input;

  if (status === "error") reasons.push("error");
  if (status === "blocked") reasons.push("blocked");
  if (status === "offline") reasons.push("offline");

  if (status !== "charging" && battery < LOW_BATTERY_THRESHOLD) {
    reasons.push("low_battery");
  }

  if (
    status === "maintenance" &&
    statusDwellSeconds > EXPECTED_DWELL_SECONDS.maintenance * MAINTENANCE_STUCK_MULTIPLIER
  ) {
    reasons.push("stuck_in_maintenance");
  }

  return reasons;
}
