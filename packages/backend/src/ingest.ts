import type { FastifyInstance } from "fastify";
import type { RobotType, TelemetryEvent } from "@waypoint/shared";
import { upsertTelemetry, removeRobot } from "./state.js";
import { setConnectedRobots } from "./metrics.js";

interface RegisterMessage {
  robot_id: string;
  robot_type: RobotType;
  start?: { x: number; y: number };
}

function isRegisterMessage(msg: unknown): msg is RegisterMessage {
  const m = msg as Partial<RegisterMessage>;
  return typeof m?.robot_id === "string" && (m.robot_type === "picker" || m.robot_type === "hauler");
}

function isTelemetryEvent(msg: unknown): msg is TelemetryEvent {
  const m = msg as Partial<TelemetryEvent>;
  return (
    typeof m?.robot_id === "string" &&
    typeof m?.t === "number" &&
    typeof m?.x === "number" &&
    typeof m?.y === "number" &&
    typeof m?.status === "string" &&
    typeof m?.battery === "number"
  );
}

const robotTypes = new Map<string, RobotType>();
let openConnections = 0;

// Basic rate limit on /ingest (PRD §10 stretch: "your endpoints will be on
// the public internet"): caps each connection to a sane number of messages
// per second, independent of how many real robots share it, so a
// misbehaving or malicious sender can't monopolize the O(1) upsert path.
const MAX_MSGS_PER_SEC = 200;
const rateState = new WeakMap<object, { windowStart: number; count: number }>();

function isRateLimited(socket: object): boolean {
  const now = Date.now();
  const state = rateState.get(socket) ?? { windowStart: now, count: 0 };
  if (now - state.windowStart >= 1000) {
    state.windowStart = now;
    state.count = 0;
  }
  state.count++;
  rateState.set(socket, state);
  return state.count > MAX_MSGS_PER_SEC;
}

export function registerIngestRoute(app: FastifyInstance): void {
  app.get("/ingest", { websocket: true }, (socket) => {
    let boundRobotId: string | undefined;
    openConnections++;
    setConnectedRobots(openConnections);

    socket.on("message", (raw: Buffer) => {
      if (isRateLimited(socket)) return;

      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // malformed frame, drop silently — never crash ingest on bad input
      }

      if (isRegisterMessage(msg)) {
        robotTypes.set(msg.robot_id, msg.robot_type);
        boundRobotId = msg.robot_id;
        return;
      }

      if (isTelemetryEvent(msg)) {
        boundRobotId = msg.robot_id;
        upsertTelemetry(msg, robotTypes.get(msg.robot_id));
      }
    });

    socket.on("close", () => {
      openConnections = Math.max(0, openConnections - 1);
      setConnectedRobots(openConnections);
      // Deliberately do NOT remove or mark offline here — a clean close is
      // not trustworthy on its own (PRD §3: offline detection is
      // server-side). The staleness sweep is the single source of truth.
      void boundRobotId;
    });

    socket.on("error", () => {
      // connection-level errors are handled the same as close; no action needed.
    });
  });
}

export function evictRobot(robotId: string): void {
  robotTypes.delete(robotId);
  removeRobot(robotId);
}
