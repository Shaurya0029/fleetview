import WebSocket from "ws";
import type { RobotRosterEntry, RobotStatus, TaskEvent, TelemetryEvent } from "@waypoint/shared";
import { advanceAlongPath, findPath, pickTarget, CHARGING_DOCK, type MotionState } from "./motion.js";
import { stepBattery } from "./battery.js";
import { maybeTransition } from "./statusTransitions.js";

const SPEED_PX_PER_SEC: Record<"picker" | "hauler", number> = {
  picker: 18,
  hauler: 45,
};

export interface AgentOptions {
  backendWsUrl: string;
  getUpdateIntervalMs: () => number;
  getPayloadBytes: () => number;
}

export class RobotAgent {
  private ws: WebSocket | null = null;
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelayMs = 500;

  private motion: MotionState;
  private status: RobotStatus = "idle";
  private statusSince = Date.now();
  private battery: number;
  private seq = 0;
  private readonly startedAt = Date.now();
  private pendingTaskEvent: TaskEvent | undefined;

  constructor(
    private readonly entry: RobotRosterEntry,
    private readonly opts: AgentOptions
  ) {
    this.motion = { pos: { ...entry.start }, path: [] };
    this.battery = 55 + Math.random() * 40;
  }

  start(): void {
    this.stopped = false;
    this.connect();
    this.scheduleTick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  private connect(): void {
    if (this.stopped) return;
    const ws = new WebSocket(this.opts.backendWsUrl);
    this.ws = ws;

    ws.on("open", () => {
      this.reconnectDelayMs = 500;
      ws.send(
        JSON.stringify({
          robot_id: this.entry.robot_id,
          robot_type: this.entry.robot_type,
          start: this.entry.start,
        })
      );
    });

    const scheduleReconnect = () => {
      if (this.stopped) return;
      const jitter = this.reconnectDelayMs * (0.15 * Math.random());
      const delay = Math.min(this.reconnectDelayMs + jitter, 15000);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 1.7, 15000);
    };

    ws.on("close", scheduleReconnect);
    ws.on("error", () => {
      ws.close();
    });
  }

  private scheduleTick(): void {
    if (this.stopped) return;
    const interval = this.opts.getUpdateIntervalMs();
    this.timer = setTimeout(() => {
      this.tick(interval);
      this.scheduleTick();
    }, interval);
  }

  private ensureMovementTarget(dock = false): void {
    if (this.motion.path.length > 0) return;
    const target = dock ? CHARGING_DOCK : pickTarget(this.entry.robot_type, this.motion.pos);
    this.motion.path = findPath(this.motion.pos, target);
  }

  private tick(intervalMs: number): void {
    const now = Date.now();
    const dwellSeconds = (now - this.statusSince) / 1000;
    const dtSeconds = intervalMs / 1000;

    const nextStatus = maybeTransition(this.status, dwellSeconds, this.battery);
    if (nextStatus !== this.status) {
      if (nextStatus === "on_mission") this.pendingTaskEvent = "task_started";
      else if (this.status === "on_mission") this.pendingTaskEvent = "task_completed";
      this.status = nextStatus;
      this.statusSince = now;
      this.motion.path = []; // force a fresh target under the new status
    }

    this.battery = stepBattery(this.status, this.battery, dtSeconds);

    const speed = SPEED_PX_PER_SEC[this.entry.robot_type];
    if (this.status === "active" || this.status === "on_mission") {
      this.ensureMovementTarget(false);
      advanceAlongPath(this.motion, speed * dtSeconds);
    } else if (this.status === "charging") {
      this.ensureMovementTarget(true);
      advanceAlongPath(this.motion, speed * dtSeconds);
    }
    // idle / blocked / error / maintenance / offline: stay put, path left as-is

    this.publish();
  }

  private publish(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const event: TelemetryEvent = {
      t: Math.floor((Date.now() - this.startedAt) / 1000),
      robot_id: this.entry.robot_id,
      x: Math.round(this.motion.pos.x * 10) / 10,
      y: Math.round(this.motion.pos.y * 10) / 10,
      status: this.status,
      battery: Math.round(this.battery * 10) / 10,
      seq: ++this.seq,
    };
    if (this.pendingTaskEvent) {
      event.task_event = this.pendingTaskEvent;
      this.pendingTaskEvent = undefined;
    }

    const payloadBytes = this.opts.getPayloadBytes();
    if (payloadBytes > 0) {
      const base = JSON.stringify(event);
      const overhead = 11; // ,"_pad":""
      const padLen = Math.max(0, payloadBytes - base.length - overhead);
      if (padLen > 0) event._pad = "x".repeat(padLen);
    }

    this.ws.send(JSON.stringify(event));
  }
}
