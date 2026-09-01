import { buildRoster } from "./roster.js";
import { RobotAgent } from "./robotAgent.js";

const BACKEND_WS_URL = process.env.BACKEND_WS_URL ?? "ws://localhost:8080/ingest";
const BACKEND_HTTP_URL =
  process.env.BACKEND_HTTP_URL ?? BACKEND_WS_URL.replace(/^ws/, "http").replace(/\/ingest$/, "");
const CONFIG_POLL_MS = Number(process.env.CONFIG_POLL_MS ?? 4000);

// Live-mutable desired state (PRD §7.5): polled from the backend's public
// GET /config so `POST /admin/config` on the live deployment reshapes the
// running fleet without a simulator restart.
const liveConfig = {
  fleet_size: Number(process.env.FLEET_SIZE ?? 8),
  update_interval_ms: Number(process.env.UPDATE_INTERVAL_MS ?? 5000),
  payload_bytes: Number(process.env.PAYLOAD_BYTES ?? 0),
};

const agents = new Map<string, RobotAgent>();
let roster = buildRoster(liveConfig.fleet_size);

function agentOptions() {
  return {
    backendWsUrl: BACKEND_WS_URL,
    getUpdateIntervalMs: () => liveConfig.update_interval_ms,
    getPayloadBytes: () => liveConfig.payload_bytes,
  };
}

function reconcileFleetSize(): void {
  if (liveConfig.fleet_size > roster.length) {
    roster = buildRoster(liveConfig.fleet_size);
  }

  const desired = roster.slice(0, liveConfig.fleet_size);
  const desiredIds = new Set(desired.map((r) => r.robot_id));

  // Stop agents no longer in scope. The backend does not need an explicit
  // "remove" — an agent that stops publishing is indistinguishable from a
  // dropped connection, and the staleness sweep marks it offline, which is
  // the same failure-handling path already required for flaky networks.
  for (const [id, agent] of agents) {
    if (!desiredIds.has(id)) {
      agent.stop();
      agents.delete(id);
    }
  }

  for (const entry of desired) {
    if (!agents.has(entry.robot_id)) {
      const agent = new RobotAgent(entry, agentOptions());
      agents.set(entry.robot_id, agent);
      agent.start();
    }
  }
}

async function pollConfig(): Promise<void> {
  try {
    const res = await fetch(`${BACKEND_HTTP_URL}/config`);
    if (!res.ok) return;
    const cfg = (await res.json()) as Partial<typeof liveConfig>;
    let changed = false;
    if (typeof cfg.fleet_size === "number" && cfg.fleet_size !== liveConfig.fleet_size) {
      liveConfig.fleet_size = cfg.fleet_size;
      changed = true;
    }
    if (typeof cfg.update_interval_ms === "number") liveConfig.update_interval_ms = cfg.update_interval_ms;
    if (typeof cfg.payload_bytes === "number") liveConfig.payload_bytes = cfg.payload_bytes;
    if (changed) reconcileFleetSize();
  } catch {
    // backend unreachable this cycle — keep running with last-known config
  }
}

reconcileFleetSize();
setInterval(pollConfig, CONFIG_POLL_MS).unref();

console.log(
  `[simulator] running ${liveConfig.fleet_size} robots -> ${BACKEND_WS_URL}, interval=${liveConfig.update_interval_ms}ms, payload_bytes=${liveConfig.payload_bytes}`
);
