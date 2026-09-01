import type { FastifyInstance } from "fastify";
import type { AdminConfigBody } from "@waypoint/shared";
import { ADMIN_TOKEN, runtimeConfig, updateRuntimeConfig } from "../config.js";
import { getMetrics } from "../metrics.js";

export function registerAdminRoutes(app: FastifyInstance): void {
  // Public, read-only: the simulator polls this to learn the desired
  // fleet_size / update_interval_ms without needing the admin token, and the
  // dashboard's live-controls panel uses it to show current values.
  app.get("/config", async () => runtimeConfig);

  app.get("/metrics", async () => getMetrics());

  app.post<{ Body: AdminConfigBody }>("/admin/config", async (req, reply) => {
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";

    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
      reply.code(401);
      return { error: "unauthorized" };
    }

    const body = req.body ?? {};
    if (
      (body.fleet_size !== undefined && (!Number.isFinite(body.fleet_size) || body.fleet_size < 0)) ||
      (body.update_interval_ms !== undefined &&
        (!Number.isFinite(body.update_interval_ms) || body.update_interval_ms < 50)) ||
      (body.payload_bytes !== undefined && (!Number.isFinite(body.payload_bytes) || body.payload_bytes < 0))
    ) {
      reply.code(400);
      return { error: "invalid config values" };
    }

    return updateRuntimeConfig(body);
  });
}
