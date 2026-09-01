import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RobotState } from "@waypoint/shared";

export type ConnectionStatus = "connecting" | "live" | "reconnecting" | "offline";

type Listener = () => void;

/**
 * Canonical client-side fleet state, kept outside React so a high-frequency
 * WS diff stream never forces a full-tree re-render. Consumers pick their
 * own update cadence:
 *  - SiteView subscribes via `useFleetVersion` (rAF-throttled: at most once
 *    per animation frame, however many diffs arrived in between).
 *  - FleetList / Header / TrendChart use `useThrottledFleetSnapshot`, which
 *    polls at a fixed, coarser interval — sorting/filtering a few thousand
 *    rows 60x/sec would be wasted work those views don't need.
 */
class FleetStore {
  robots = new Map<string, RobotState>();
  connectionStatus: ConnectionStatus = "connecting";
  lastSnapshotAt: number | null = null;
  version = 0;

  private listeners = new Set<Listener>();
  private notifyScheduled = false;

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  private scheduleNotify(): void {
    this.version++;
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    requestAnimationFrame(() => {
      this.notifyScheduled = false;
      for (const l of this.listeners) l();
    });
  }

  setConnectionStatus(status: ConnectionStatus): void {
    if (this.connectionStatus === status) return;
    this.connectionStatus = status;
    this.scheduleNotify();
  }

  applySnapshot(robots: RobotState[]): void {
    this.robots = new Map(robots.map((r) => [r.robot_id, r]));
    this.lastSnapshotAt = Date.now();
    this.scheduleNotify();
  }

  applyDiff(updated: RobotState[], removed: string[]): void {
    for (const r of updated) this.robots.set(r.robot_id, r);
    for (const id of removed) this.robots.delete(id);
    this.scheduleNotify();
  }

  getVersion = (): number => this.version;

  getRobotsArray(): RobotState[] {
    return Array.from(this.robots.values());
  }
}

export const fleetStore = new FleetStore();

/** Re-renders at most once per animation frame when fleet state changes. */
export function useFleetVersion(): number {
  return useSyncExternalStore(fleetStore.subscribe, fleetStore.getVersion, fleetStore.getVersion);
}

/** Re-renders on a fixed wall-clock cadence, not on every store update. */
export function useThrottledFleetSnapshot(intervalMs: number): {
  robots: RobotState[];
  connectionStatus: ConnectionStatus;
} {
  const [, setTick] = useState(0);
  const lastVersion = useRef(-1);

  useEffect(() => {
    const id = setInterval(() => {
      if (fleetStore.version !== lastVersion.current) {
        lastVersion.current = fleetStore.version;
        setTick((t) => t + 1);
      }
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return { robots: fleetStore.getRobotsArray(), connectionStatus: fleetStore.connectionStatus };
}
