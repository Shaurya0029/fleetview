import type { RuntimeConfig } from "@waypoint/shared";

export const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";
export const PORT = Number(process.env.PORT ?? 8080);
export const STALENESS_SWEEP_MS = Number(process.env.STALENESS_SWEEP_MS ?? 2000);
export const BROADCAST_TICK_MS = Number(process.env.BROADCAST_TICK_MS ?? 350);
export const RING_BUFFER_CAPACITY = Number(process.env.RING_BUFFER_CAPACITY ?? 720);

export const runtimeConfig: RuntimeConfig = {
  fleet_size: Number(process.env.FLEET_SIZE ?? 8),
  update_interval_ms: Number(process.env.UPDATE_INTERVAL_MS ?? 5000),
  payload_bytes: Number(process.env.PAYLOAD_BYTES ?? 0),
};

export type ConfigListener = (config: RuntimeConfig) => void;
const listeners = new Set<ConfigListener>();

export function onConfigChange(listener: ConfigListener): void {
  listeners.add(listener);
}

export function updateRuntimeConfig(patch: Partial<RuntimeConfig>): RuntimeConfig {
  if (patch.fleet_size !== undefined) {
    runtimeConfig.fleet_size = Math.max(0, Math.floor(patch.fleet_size));
  }
  if (patch.update_interval_ms !== undefined) {
    runtimeConfig.update_interval_ms = Math.max(50, Math.floor(patch.update_interval_ms));
  }
  if (patch.payload_bytes !== undefined) {
    runtimeConfig.payload_bytes = Math.max(0, Math.floor(patch.payload_bytes));
  }
  for (const listener of listeners) listener(runtimeConfig);
  return runtimeConfig;
}
