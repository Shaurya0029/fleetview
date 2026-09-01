export type RobotType = "picker" | "hauler";

export type RobotStatus =
  | "idle"
  | "active"
  | "on_mission"
  | "charging"
  | "blocked"
  | "error"
  | "maintenance"
  | "offline";

export type TaskEvent = "task_started" | "task_completed";

export interface RobotStart {
  x: number;
  y: number;
}

export interface RobotRosterEntry {
  robot_id: string;
  robot_type: RobotType;
  start: RobotStart;
}

/** Wire format published by a robot to WS /ingest. Matches the data contract exactly. */
export interface TelemetryEvent {
  t: number;
  robot_id: string;
  x: number;
  y: number;
  status: RobotStatus;
  battery: number;
  task_event?: TaskEvent;
  /** Monotonic per-robot counter assigned by the simulator; used to discard out-of-order packets. */
  seq?: number;
  /** Padding to reach a configured PAYLOAD_BYTES target. Ignored by consumers. */
  _pad?: string;
}

/** Server-side view of a robot: telemetry plus everything the backend derives. */
export interface RobotState {
  robot_id: string;
  robot_type: RobotType;
  t: number;
  x: number;
  y: number;
  status: RobotStatus;
  battery: number;
  task_event?: TaskEvent;
  seq: number;
  last_seen: number;
  status_since: number;
  connected: boolean;
  needs_attention: boolean;
  needs_attention_reasons: string[];
  /** Set when the robot went offline while on_mission, so the UI can show "last seen mid-mission". */
  last_mission_context?: {
    status: RobotStatus;
    at: number;
  };
}

export interface StreamSnapshotMessage {
  type: "snapshot";
  ts: number;
  robots: RobotState[];
}

export interface StreamDiffMessage {
  type: "diff";
  tick: number;
  ts: number;
  updated: RobotState[];
  removed: string[];
}

export type StreamMessage = StreamSnapshotMessage | StreamDiffMessage;

export interface AdminConfigBody {
  fleet_size?: number;
  update_interval_ms?: number;
  payload_bytes?: number;
}

export interface RuntimeConfig {
  fleet_size: number;
  update_interval_ms: number;
  payload_bytes: number;
}

export interface BackendMetrics {
  ts: number;
  ingest_msgs_per_sec: number;
  connected_robots: number;
  connected_dashboards: number;
  last_tick_duration_ms: number;
  last_tick_updated_count: number;
  state_map_size: number;
}

export interface HistoryPoint {
  t: number;
  x: number;
  y: number;
  status: RobotStatus;
  battery: number;
}
