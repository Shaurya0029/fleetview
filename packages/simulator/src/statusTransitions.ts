import { isLegalTransition, type RobotStatus } from "@waypoint/shared";
import { LOW_BATTERY_CHARGE_TRIGGER, FULLY_CHARGED_THRESHOLD } from "./battery.js";

interface TransitionOption {
  to: RobotStatus;
  weight: (battery: number) => number;
}

interface StatusRule {
  minDwellSeconds: number;
  /** Chance per tick, once minDwellSeconds has elapsed, that a transition is attempted at all. */
  attemptChance: number;
  options: TransitionOption[];
}

/**
 * Legal-transition-respecting status state machine (PRD §6). Every `to` here
 * is also checked against shared isLegalTransition as a safety net — this
 * table should never disagree with it, but if it ever does, the legality
 * check wins and the transition is skipped.
 */
const RULES: Record<RobotStatus, StatusRule> = {
  idle: {
    minDwellSeconds: 15,
    attemptChance: 0.3,
    options: [
      { to: "active", weight: () => 3 },
      { to: "on_mission", weight: () => 3 },
      { to: "charging", weight: (b) => (b < LOW_BATTERY_CHARGE_TRIGGER ? 8 : 0.4) },
      { to: "maintenance", weight: () => 0.15 },
      { to: "error", weight: () => 0.1 },
    ],
  },
  active: {
    minDwellSeconds: 20,
    attemptChance: 0.3,
    options: [
      { to: "idle", weight: () => 2 },
      { to: "on_mission", weight: () => 2.5 },
      { to: "blocked", weight: () => 0.35 },
      { to: "error", weight: () => 0.15 },
      { to: "charging", weight: (b) => (b < LOW_BATTERY_CHARGE_TRIGGER ? 7 : 0.2) },
    ],
  },
  on_mission: {
    minDwellSeconds: 30,
    attemptChance: 0.28,
    options: [
      { to: "active", weight: () => 2 },
      { to: "idle", weight: () => 1.2 },
      { to: "blocked", weight: () => 0.4 },
      { to: "error", weight: () => 0.15 },
      { to: "charging", weight: (b) => (b < LOW_BATTERY_CHARGE_TRIGGER ? 7 : 0.15) },
    ],
  },
  charging: {
    minDwellSeconds: 20,
    attemptChance: 0.5,
    options: [
      { to: "idle", weight: (b) => (b >= FULLY_CHARGED_THRESHOLD ? 5 : 0) },
      { to: "active", weight: (b) => (b >= FULLY_CHARGED_THRESHOLD ? 2 : 0) },
    ],
  },
  blocked: {
    minDwellSeconds: 8,
    attemptChance: 0.4,
    options: [
      { to: "active", weight: () => 3 },
      { to: "on_mission", weight: () => 2 },
      { to: "idle", weight: () => 1 },
      { to: "error", weight: () => 0.25 },
    ],
  },
  error: {
    minDwellSeconds: 15,
    attemptChance: 0.35,
    options: [
      { to: "maintenance", weight: () => 2 },
      { to: "idle", weight: () => 1 },
    ],
  },
  maintenance: {
    minDwellSeconds: 25,
    attemptChance: 0.35,
    options: [
      { to: "idle", weight: () => 3 },
      { to: "active", weight: () => 1 },
    ],
  },
  offline: { minDwellSeconds: 0, attemptChance: 0, options: [] },
};

export function maybeTransition(
  current: RobotStatus,
  dwellSeconds: number,
  battery: number,
  rand: () => number = Math.random
): RobotStatus {
  const rule = RULES[current];
  if (!rule || dwellSeconds < rule.minDwellSeconds) return current;
  if (rand() >= rule.attemptChance) return current;

  const weighted = rule.options
    .map((o) => ({ to: o.to, weight: o.weight(battery) }))
    .filter((o) => o.weight > 0 && isLegalTransition(current, o.to));

  const total = weighted.reduce((s, o) => s + o.weight, 0);
  if (total <= 0) return current;

  let r = rand() * total;
  for (const o of weighted) {
    r -= o.weight;
    if (r <= 0) return o.to;
  }
  return current;
}
