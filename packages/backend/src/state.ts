import {
  computeAttention,
  type HistoryPoint,
  type RobotState,
  type RobotType,
  type TelemetryEvent,
} from "@waypoint/shared";
import { RING_BUFFER_CAPACITY } from "./config.js";
import { RingBuffer } from "./ringBuffer.js";
import { recordIngest } from "./metrics.js";
import { appendHistory } from "./historyStore.js";

const robots = new Map<string, RobotState>();
const history = new Map<string, RingBuffer<HistoryPoint>>();
/** robot_ids updated since the last broadcast tick was gathered. */
const dirty = new Set<string>();
/** robot_ids removed (e.g. fleet shrunk) since the last broadcast tick. */
const removedSinceTick = new Set<string>();

function historyBufferFor(robotId: string): RingBuffer<HistoryPoint> {
  let rb = history.get(robotId);
  if (!rb) {
    rb = new RingBuffer<HistoryPoint>(RING_BUFFER_CAPACITY);
    history.set(robotId, rb);
  }
  return rb;
}

export interface UpsertResult {
  accepted: boolean;
  reason?: string;
}

/**
 * O(1) upsert of one telemetry event into the state map. Discards events
 * older than what's already stored for that robot (out-of-order guard, see
 * PRD §4.3) using the simulator-assigned monotonic `seq` when present, and
 * `t` otherwise.
 */
export function upsertTelemetry(
  event: TelemetryEvent,
  robotType: RobotType | undefined
): UpsertResult {
  recordIngest();
  const now = Date.now();
  const existing = robots.get(event.robot_id);

  if (existing) {
    const incomingSeq = event.seq;
    if (incomingSeq !== undefined) {
      if (incomingSeq <= existing.seq) {
        return { accepted: false, reason: "stale_seq" };
      }
    } else if (event.t < existing.t) {
      return { accepted: false, reason: "stale_t" };
    }
  }

  const statusChanged = !existing || existing.status !== event.status;
  const statusSince = statusChanged ? now : existing!.status_since;
  const dwellSeconds = (now - statusSince) / 1000;

  const reasons = computeAttention({
    status: event.status,
    battery: event.battery,
    statusDwellSeconds: dwellSeconds,
  });

  const wasOnMission = existing?.status === "on_mission";
  const lastMissionContext =
    wasOnMission && event.status !== "on_mission"
      ? existing?.last_mission_context
      : wasOnMission
        ? { status: "on_mission" as const, at: now }
        : existing?.last_mission_context;

  const next: RobotState = {
    robot_id: event.robot_id,
    robot_type: robotType ?? existing?.robot_type ?? "picker",
    t: event.t,
    x: event.x,
    y: event.y,
    status: event.status,
    battery: event.battery,
    task_event: event.task_event,
    seq: event.seq ?? (existing?.seq ?? 0) + 1,
    last_seen: now,
    status_since: statusSince,
    connected: true,
    needs_attention: reasons.length > 0,
    needs_attention_reasons: reasons,
    last_mission_context: lastMissionContext,
  };

  robots.set(event.robot_id, next);
  dirty.add(event.robot_id);
  removedSinceTick.delete(event.robot_id);

  const point: HistoryPoint = {
    t: event.t,
    x: event.x,
    y: event.y,
    status: event.status,
    battery: event.battery,
  };
  historyBufferFor(event.robot_id).push(point);
  appendHistory(event.robot_id, point);

  return { accepted: true };
}

export function getAllRobots(): RobotState[] {
  return Array.from(robots.values());
}

export function getRobot(robotId: string): RobotState | undefined {
  return robots.get(robotId);
}

export function removeRobot(robotId: string): void {
  if (robots.delete(robotId)) {
    history.delete(robotId);
    dirty.delete(robotId);
    removedSinceTick.add(robotId);
  }
}

export function getRecentHistory(robotId: string, from?: number, to?: number): HistoryPoint[] {
  const points = historyBufferFor(robotId).toArray();
  if (from === undefined && to === undefined) return points;
  return points.filter((p) => (from === undefined || p.t >= from) && (to === undefined || p.t <= to));
}

/** Drains everything that changed since the last tick. Called once per broadcast tick. */
export function drainDirty(): { updated: RobotState[]; removed: string[] } {
  const updated: RobotState[] = [];
  for (const id of dirty) {
    const r = robots.get(id);
    if (r) updated.push(r);
  }
  dirty.clear();
  const removed = Array.from(removedSinceTick);
  removedSinceTick.clear();
  return { updated, removed };
}

/**
 * Server-side staleness sweep (PRD §3, §7.6): mark any robot not heard from
 * in `staleAfterMs` as offline. Also refreshes maintenance-dwell-based
 * attention between telemetry messages.
 */
export function sweepStaleness(staleAfterMs: number): string[] {
  const now = Date.now();
  const changed: string[] = [];
  for (const [id, r] of robots) {
    const silentFor = now - r.last_seen;
    if (r.status !== "offline" && silentFor > staleAfterMs) {
      const dwellSeconds = (now - r.status_since) / 1000;
      const lastMissionContext =
        r.status === "on_mission" ? { status: "on_mission" as const, at: now } : r.last_mission_context;
      const updated: RobotState = {
        ...r,
        status: "offline",
        status_since: now,
        connected: false,
        needs_attention: true,
        needs_attention_reasons: ["offline"],
        last_mission_context: lastMissionContext,
      };
      robots.set(id, updated);
      dirty.add(id);
      changed.push(id);
      continue;
    }

    if (r.status === "maintenance") {
      const dwellSeconds = (now - r.status_since) / 1000;
      const reasons = computeAttention({
        status: r.status,
        battery: r.battery,
        statusDwellSeconds: dwellSeconds,
      });
      const needsAttention = reasons.length > 0;
      if (needsAttention !== r.needs_attention) {
        robots.set(id, { ...r, needs_attention: needsAttention, needs_attention_reasons: reasons });
        dirty.add(id);
        changed.push(id);
      }
    }
  }
  return changed;
}

export function stateMapSize(): number {
  return robots.size;
}
