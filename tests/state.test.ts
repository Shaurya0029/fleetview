import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";

// Each test gets a fresh module graph (state.ts holds module-level Maps) and
// its own throwaway SQLite file, so tests never see each other's robots.
beforeEach(() => {
  vi.resetModules();
  process.env.HISTORY_DB_PATH = path.join(os.tmpdir(), `waypoint-test-${Math.random()}.db`);
});

async function freshState() {
  return import("../packages/backend/src/state.js");
}

describe("upsertTelemetry", () => {
  it("accepts an update with a higher seq and rejects one with an equal-or-lower seq", async () => {
    const { upsertTelemetry, getRobot } = await freshState();

    upsertTelemetry({ t: 0, robot_id: "r1", x: 10, y: 10, status: "idle", battery: 50, seq: 1 }, "picker");
    expect(getRobot("r1")?.x).toBe(10);

    const stale = upsertTelemetry(
      { t: 1, robot_id: "r1", x: 999, y: 999, status: "idle", battery: 50, seq: 1 },
      "picker"
    );
    expect(stale.accepted).toBe(false);
    expect(getRobot("r1")?.x).toBe(10); // position must NOT have rolled forward from the stale packet

    const older = upsertTelemetry(
      { t: 1, robot_id: "r1", x: 111, y: 111, status: "idle", battery: 50, seq: 0 },
      "picker"
    );
    expect(older.accepted).toBe(false);

    const fresh = upsertTelemetry(
      { t: 2, robot_id: "r1", x: 20, y: 20, status: "idle", battery: 51, seq: 2 },
      "picker"
    );
    expect(fresh.accepted).toBe(true);
    expect(getRobot("r1")?.x).toBe(20);
  });

  it("falls back to comparing `t` when seq is absent, so an out-of-order older `t` is discarded", async () => {
    const { upsertTelemetry, getRobot } = await freshState();

    upsertTelemetry({ t: 10, robot_id: "r2", x: 1, y: 1, status: "idle", battery: 50 }, "hauler");
    const result = upsertTelemetry({ t: 5, robot_id: "r2", x: 2, y: 2, status: "idle", battery: 50 }, "hauler");

    expect(result.accepted).toBe(false);
    expect(getRobot("r2")?.t).toBe(10);
  });

  it("flags error, blocked, and low-battery-while-not-charging as needing attention", async () => {
    const { upsertTelemetry, getRobot } = await freshState();

    upsertTelemetry({ t: 0, robot_id: "r3", x: 0, y: 0, status: "error", battery: 80, seq: 1 }, "picker");
    expect(getRobot("r3")?.needs_attention).toBe(true);
    expect(getRobot("r3")?.needs_attention_reasons).toContain("error");

    upsertTelemetry({ t: 1, robot_id: "r4", x: 0, y: 0, status: "active", battery: 10, seq: 1 }, "hauler");
    expect(getRobot("r4")?.needs_attention_reasons).toContain("low_battery");

    upsertTelemetry({ t: 1, robot_id: "r5", x: 0, y: 0, status: "charging", battery: 10, seq: 1 }, "hauler");
    expect(getRobot("r5")?.needs_attention).toBe(false); // low battery is expected while charging
  });

  it("does not flag a healthy idle robot", async () => {
    const { upsertTelemetry, getRobot } = await freshState();
    upsertTelemetry({ t: 0, robot_id: "r6", x: 0, y: 0, status: "idle", battery: 80, seq: 1 }, "picker");
    expect(getRobot("r6")?.needs_attention).toBe(false);
  });
});

describe("sweepStaleness", () => {
  it("marks a silent robot offline and leaves its last mission context attached", async () => {
    const { upsertTelemetry, sweepStaleness, getRobot } = await freshState();

    upsertTelemetry({ t: 0, robot_id: "r7", x: 0, y: 0, status: "on_mission", battery: 80, seq: 1 }, "hauler");
    expect(getRobot("r7")?.status).toBe("on_mission");

    // simulate silence with a negative staleness threshold — any robot is
    // immediately "overdue" without needing to fake the system clock (a 0ms
    // threshold would be flaky: last_seen and the sweep can land in the same
    // millisecond, making "silentFor > 0" false)
    const changed = sweepStaleness(-1);

    expect(changed).toContain("r7");
    const after = getRobot("r7");
    expect(after?.status).toBe("offline");
    expect(after?.connected).toBe(false);
    expect(after?.needs_attention).toBe(true);
    expect(after?.last_mission_context?.status).toBe("on_mission");
  });

  it("leaves a recently-seen robot alone", async () => {
    const { upsertTelemetry, sweepStaleness, getRobot } = await freshState();
    upsertTelemetry({ t: 0, robot_id: "r8", x: 0, y: 0, status: "idle", battery: 80, seq: 1 }, "picker");

    sweepStaleness(999_999); // effectively "never times out"
    expect(getRobot("r8")?.status).toBe("idle");
  });

  it("evicts a robot from state once it has been offline longer than evictAfterMs (e.g. after a fleet-size scale-down)", async () => {
    const { upsertTelemetry, sweepStaleness, getRobot } = await freshState();
    upsertTelemetry({ t: 0, robot_id: "r10", x: 0, y: 0, status: "idle", battery: 80, seq: 1 }, "picker");

    // first sweep: goes offline, same as today — eviction is opt-in via the
    // second argument, so a caller that only passes staleAfterMs (like the
    // existing tests above) sees no change in behavior at all.
    sweepStaleness(-1);
    expect(getRobot("r10")?.status).toBe("offline");

    // second sweep, now with an eviction threshold: an already-offline
    // robot silent past evictAfterMs is removed from state entirely.
    const changed = sweepStaleness(-1, -1);
    expect(changed).toContain("r10");
    expect(getRobot("r10")).toBeUndefined();
  });

  it("does not evict an offline robot before evictAfterMs has elapsed", async () => {
    const { upsertTelemetry, sweepStaleness, getRobot } = await freshState();
    upsertTelemetry({ t: 0, robot_id: "r11", x: 0, y: 0, status: "idle", battery: 80, seq: 1 }, "picker");

    sweepStaleness(-1); // goes offline
    expect(getRobot("r11")?.status).toBe("offline");

    sweepStaleness(-1, 999_999); // eviction threshold effectively "never"
    expect(getRobot("r11")?.status).toBe("offline");
    expect(getRobot("r11")).toBeDefined();
  });
});

describe("drainDirty", () => {
  it("returns only robots changed since the last drain, then clears", async () => {
    const { upsertTelemetry, drainDirty } = await freshState();

    upsertTelemetry({ t: 0, robot_id: "r9", x: 0, y: 0, status: "idle", battery: 80, seq: 1 }, "picker");
    const first = drainDirty();
    expect(first.updated.map((r) => r.robot_id)).toEqual(["r9"]);

    const second = drainDirty();
    expect(second.updated).toEqual([]);
    expect(second.removed).toEqual([]);
  });
});
