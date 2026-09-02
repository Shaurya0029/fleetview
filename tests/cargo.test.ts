import { describe, expect, it } from "vitest";
import type { RobotStatus } from "../packages/shared/src/types.js";
import { CARGO_CATALOG } from "../packages/shared/src/warehouse.js";
import { isWorkingStatus, pickCargo } from "../packages/simulator/src/cargo.js";

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

describe("isWorkingStatus", () => {
  it("is true only for active and on_mission — cargo appears/clears exactly on this boundary", () => {
    for (const status of ALL_STATUSES) {
      const expected = status === "active" || status === "on_mission";
      expect(isWorkingStatus(status)).toBe(expected);
    }
  });
});

describe("pickCargo", () => {
  it("always returns an item that exists in the shared catalog", () => {
    for (let i = 0; i < 50; i++) {
      const cargo = pickCargo("picker");
      const match = CARGO_CATALOG.find((c) => c.sku === cargo.sku && c.label === cargo.label);
      expect(match).toBeTruthy();
    }
  });

  it("gives haulers larger quantities than pickers", () => {
    const rand = () => 0.5; // deterministic midpoint
    const pickerCargo = pickCargo("picker", rand);
    const haulerCargo = pickCargo("hauler", rand);
    expect(haulerCargo.quantity).toBeGreaterThan(pickerCargo.quantity);
  });

  it("never returns a zero or negative quantity", () => {
    for (const rand of [() => 0, () => 0.999999]) {
      expect(pickCargo("picker", rand).quantity).toBeGreaterThan(0);
      expect(pickCargo("hauler", rand).quantity).toBeGreaterThan(0);
    }
  });
});
