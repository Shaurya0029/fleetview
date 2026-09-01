import type { BackendMetrics } from "@waypoint/shared";
import { stateMapSize } from "./state.js";

let ingestCountThisSecond = 0;
let ingestMsgsPerSec = 0;
let connectedRobots = 0;
let connectedDashboards = 0;
let lastTickDurationMs = 0;
let lastTickUpdatedCount = 0;

setInterval(() => {
  ingestMsgsPerSec = ingestCountThisSecond;
  ingestCountThisSecond = 0;
}, 1000).unref();

export function recordIngest(): void {
  ingestCountThisSecond++;
}

export function setConnectedRobots(n: number): void {
  connectedRobots = n;
}

export function setConnectedDashboards(n: number): void {
  connectedDashboards = n;
}

export function recordTick(durationMs: number, updatedCount: number): void {
  lastTickDurationMs = durationMs;
  lastTickUpdatedCount = updatedCount;
}

export function getMetrics(): BackendMetrics {
  return {
    ts: Date.now(),
    ingest_msgs_per_sec: ingestMsgsPerSec,
    connected_robots: connectedRobots,
    connected_dashboards: connectedDashboards,
    last_tick_duration_ms: lastTickDurationMs,
    last_tick_updated_count: lastTickUpdatedCount,
    state_map_size: stateMapSize(),
  };
}
