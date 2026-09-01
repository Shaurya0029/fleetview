import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { StreamDiffMessage, StreamSnapshotMessage } from "@waypoint/shared";
import { drainDirty, getAllRobots } from "./state.js";
import { BROADCAST_TICK_MS } from "./config.js";
import { recordTick, setConnectedDashboards } from "./metrics.js";

const clients = new Set<WebSocket>();
const alive = new WeakMap<WebSocket, boolean>();

const OUTBOUND_BUFFER_LIMIT_BYTES = 1_000_000; // 1MB: a client this far behind gets this tick's frame skipped

export function registerStreamRoute(app: FastifyInstance): void {
  app.get("/stream", { websocket: true }, (socket: WebSocket) => {
    clients.add(socket);
    alive.set(socket, true);
    setConnectedDashboards(clients.size);

    const snapshot: StreamSnapshotMessage = {
      type: "snapshot",
      ts: Date.now(),
      robots: getAllRobots(),
    };
    socket.send(JSON.stringify(snapshot));

    socket.on("pong", () => alive.set(socket, true));

    socket.on("close", () => {
      clients.delete(socket);
      alive.delete(socket);
      setConnectedDashboards(clients.size);
    });

    socket.on("error", () => {
      clients.delete(socket);
      alive.delete(socket);
      setConnectedDashboards(clients.size);
    });
  });
}

let tickCounter = 0;

function runBroadcastTick(): void {
  const startedAt = Date.now();
  const { updated, removed } = drainDirty();

  if (updated.length === 0 && removed.length === 0) {
    recordTick(Date.now() - startedAt, 0);
    return;
  }

  tickCounter++;
  const diff: StreamDiffMessage = {
    type: "diff",
    tick: tickCounter,
    ts: Date.now(),
    updated,
    removed,
  };
  const payload = JSON.stringify(diff);

  for (const client of clients) {
    if (client.readyState !== client.OPEN) continue;
    // Backpressure guard (PRD §4.3, §7.2): never let one slow dashboard
    // block the broadcast for everyone else — just skip this tick for it.
    if (client.bufferedAmount > OUTBOUND_BUFFER_LIMIT_BYTES) continue;
    client.send(payload);
  }

  recordTick(Date.now() - startedAt, updated.length);
}

export function startBroadcastLoop(): NodeJS.Timeout {
  return setInterval(runBroadcastTick, BROADCAST_TICK_MS);
}

const HEARTBEAT_MS = 30_000;

export function startHeartbeatLoop(): NodeJS.Timeout {
  return setInterval(() => {
    for (const client of clients) {
      if (alive.get(client) === false) {
        client.terminate();
        clients.delete(client);
        continue;
      }
      alive.set(client, false);
      if (client.readyState === client.OPEN) client.ping();
    }
    setConnectedDashboards(clients.size);
  }, HEARTBEAT_MS);
}
