import { sweepStaleness } from "./state.js";
import { runtimeConfig, STALENESS_SWEEP_MS } from "./config.js";

export function startStalenessSweep(): NodeJS.Timeout {
  return setInterval(() => {
    const staleAfterMs = 3 * runtimeConfig.update_interval_ms;
    sweepStaleness(staleAfterMs);
  }, STALENESS_SWEEP_MS);
}
