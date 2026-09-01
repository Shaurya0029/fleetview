import type { RobotStatus } from "@waypoint/shared";

// Percent per second. ~5 min to drain fully while working, ~3 min to fully recharge —
// fast enough to see battery/charging cycles inside a short demo session.
const DRAIN_RATE = 100 / 300;
const CHARGE_RATE = 100 / 180;

export function stepBattery(status: RobotStatus, battery: number, dtSeconds: number): number {
  if (status === "active" || status === "on_mission") {
    return Math.max(0, battery - DRAIN_RATE * dtSeconds);
  }
  if (status === "charging") {
    return Math.min(100, battery + CHARGE_RATE * dtSeconds);
  }
  return battery; // idle, blocked, error, maintenance, offline: holds steady
}

export const LOW_BATTERY_CHARGE_TRIGGER = 20;
export const FULLY_CHARGED_THRESHOLD = 90;
