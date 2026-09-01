import { useEffect } from "react";
import type { StreamMessage } from "@waypoint/shared";
import { fleetStore } from "../state/fleetStore";

function streamUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/stream`;
}

const BASE_RECONNECT_MS = 500;
const MAX_RECONNECT_MS = 10_000;
const OFFLINE_AFTER_MS = 60_000;

/**
 * Owns the dashboard's single WS connection to /stream. Every (re)connect
 * gets a fresh `snapshot` message from the backend before any `diff`
 * messages (see backend stream.ts) — that's the "snapshot then delta"
 * pattern from PRD §4.3, so a dashboard that was disconnected never has to
 * replay missed diffs, it just re-syncs instantly on the next connection.
 */
export function useFleetSocket(): void {
  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;
    let reconnectDelay = BASE_RECONNECT_MS;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disconnectedSince: number | null = null;

    const connect = () => {
      if (stopped) return;
      fleetStore.setConnectionStatus(disconnectedSince ? "reconnecting" : "connecting");

      const socket = new WebSocket(streamUrl());
      ws = socket;

      socket.onopen = () => {
        reconnectDelay = BASE_RECONNECT_MS;
        disconnectedSince = null;
        fleetStore.setConnectionStatus("live");
      };

      socket.onmessage = (ev) => {
        let msg: StreamMessage;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return; // never let one malformed frame take down the socket handler
        }
        if (msg.type === "snapshot") {
          fleetStore.applySnapshot(msg.robots);
        } else if (msg.type === "diff") {
          fleetStore.applyDiff(msg.updated, msg.removed);
        }
      };

      const scheduleReconnect = () => {
        if (stopped) return;
        if (disconnectedSince === null) disconnectedSince = Date.now();
        const offline = Date.now() - disconnectedSince > OFFLINE_AFTER_MS;
        fleetStore.setConnectionStatus(offline ? "offline" : "reconnecting");

        const jitter = reconnectDelay * 0.2 * Math.random();
        reconnectTimer = setTimeout(connect, reconnectDelay + jitter);
        reconnectDelay = Math.min(reconnectDelay * 1.7, MAX_RECONNECT_MS);
      };

      socket.onclose = scheduleReconnect;
      socket.onerror = () => socket.close();
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);
}
