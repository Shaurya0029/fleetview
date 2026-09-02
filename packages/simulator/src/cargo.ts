import { CARGO_CATALOG, type Cargo, type RobotStatus, type RobotType } from "@waypoint/shared";

/** A robot only carries cargo while actively working a mission (PRD addendum §2.2). */
export function isWorkingStatus(status: RobotStatus): boolean {
  return status === "active" || status === "on_mission";
}

/**
 * Picks a plausible cargo item + quantity for a robot entering a working
 * status. Haulers carry point-to-point bulk loads; pickers handle smaller
 * per-item quantities — same catalog either way (PRD addendum §2.2).
 */
export function pickCargo(robotType: RobotType, rand: () => number = Math.random): Cargo {
  const item = CARGO_CATALOG[Math.floor(rand() * CARGO_CATALOG.length)];
  const quantity = robotType === "hauler" ? 10 + Math.floor(rand() * 51) : 1 + Math.floor(rand() * 12);
  return { sku: item.sku, label: item.label, quantity };
}
