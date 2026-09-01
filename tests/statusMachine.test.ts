import { describe, expect, it } from "vitest";
import { isLegalTransition, LEGAL_TRANSITIONS, type RobotStatus } from "../packages/shared/src/statusMachine.js";
import { maybeTransition } from "../packages/simulator/src/statusTransitions.js";

const ALL_STATUSES: RobotStatus[] = [
  "idle",
  "active",
  "on_mission",
  "charging",
  "blocked",
  "error",
  "maintenance",
  "offline",
];

describe("isLegalTransition", () => {
  it("forbids error from jumping straight to on_mission or active", () => {
    expect(isLegalTransition("error", "on_mission")).toBe(false);
    expect(isLegalTransition("error", "active")).toBe(false);
  });

  it("allows error to resolve through maintenance or idle", () => {
    expect(isLegalTransition("error", "maintenance")).toBe(true);
    expect(isLegalTransition("error", "idle")).toBe(true);
  });

  it("never allows a robot to self-assign offline", () => {
    for (const from of ALL_STATUSES) {
      if (from === "offline") continue; // staying offline is trivially "legal" (from === to); arriving there from elsewhere is what's forbidden
      expect(isLegalTransition(from, "offline")).toBe(false);
    }
  });

  it("always allows staying in the same status", () => {
    for (const s of ALL_STATUSES) {
      expect(isLegalTransition(s, s)).toBe(true);
    }
  });

  it("every declared edge is reachable and no status transitions to itself in the table", () => {
    for (const from of ALL_STATUSES) {
      for (const to of LEGAL_TRANSITIONS[from]) {
        expect(to).not.toBe(from);
        expect(ALL_STATUSES).toContain(to);
      }
    }
  });
});

describe("simulator maybeTransition", () => {
  it("only ever proposes transitions that isLegalTransition accepts, across many random rolls", () => {
    let seed = 42;
    const rand = () => {
      // deterministic PRNG so failures are reproducible
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed % 10000) / 10000;
    };

    for (const from of ALL_STATUSES) {
      for (let trial = 0; trial < 500; trial++) {
        const dwell = trial * 3; // sweep dwell times from 0 up past every rule's minDwell
        const battery = (trial * 7) % 100;
        const next = maybeTransition(from, dwell, battery, rand);
        expect(isLegalTransition(from, next)).toBe(true);
      }
    }
  });

  it("never proposes leaving offline (server-only status; simulator should never see it as `current`)", () => {
    const next = maybeTransition("offline", 1000, 50, Math.random);
    expect(next).toBe("offline");
  });

  it("respects minimum dwell time before ever transitioning away from a status", () => {
    // idle's minDwellSeconds is 15 — before that, it must never move regardless of rolls
    for (let trial = 0; trial < 200; trial++) {
      const next = maybeTransition("idle", 5, 50, Math.random);
      expect(next).toBe("idle");
    }
  });

  it("strongly biases a low-battery robot toward charging, among the transitions it actually attempts", () => {
    // attemptChance gates whether a transition happens at all each tick; conditioning on
    // "did attempt" isolates the weighting behavior (which is what battery affects) from that gate.
    let chargingCount = 0;
    let attemptedCount = 0;
    const trials = 2000;
    for (let i = 0; i < trials; i++) {
      const next = maybeTransition("active", 25, 5, Math.random);
      if (next !== "active") {
        attemptedCount++;
        if (next === "charging") chargingCount++;
      }
    }
    expect(attemptedCount).toBeGreaterThan(0);
    expect(chargingCount / attemptedCount).toBeGreaterThan(0.5);
  });
});
