import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";

import { PORT, ADMIN_TOKEN } from "./config.js";
import { registerIngestRoute } from "./ingest.js";
import { registerStreamRoute, startBroadcastLoop, startHeartbeatLoop } from "./stream.js";
import { registerRobotRoutes } from "./routes/robots.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { startStalenessSweep } from "./staleness.js";
import { isHistoryPersistenceEnabled } from "./historyStore.js";
import { startEmbeddedSimulatorIfEnabled } from "./simulatorProcess.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// disableRequestLogging: per-request access logging is the first thing that
// falls over under connection churn — a burst of thousands of new /ingest
// WebSocket upgrades each cost a JSON-serialize-and-write on both the
// "incoming request" and "request completed" hooks, which measurably stalls
// the event loop at fleet sizes in the thousands (see FINDINGS.md). The
// steady-state ingest/broadcast path itself doesn't need per-message logs.
const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "warn" },
  disableRequestLogging: true,
});

await app.register(fastifyWebsocket);

registerIngestRoute(app);
registerStreamRoute(app);
registerRobotRoutes(app);
registerAdminRoutes(app);

app.get("/healthz", async () => ({ ok: true, history_persistence: isHistoryPersistenceEnabled() }));

// Serve the built dashboard as static files so the backend and dashboard are
// one deployable service with one URL (PRD §4.1). The dashboard build output
// is copied/built into packages/backend/public at build time.
const staticRoot = path.join(__dirname, "..", "public");
await app.register(fastifyStatic, {
  root: staticRoot,
});

app.setNotFoundHandler((req, reply) => {
  reply.code(404).send({ error: "not found" });
});

if (!ADMIN_TOKEN) {
  app.log.warn("ADMIN_TOKEN is not set — POST /admin/config will reject all requests until it is.");
}

startBroadcastLoop();
startHeartbeatLoop();
startStalenessSweep();

try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
  startEmbeddedSimulatorIfEnabled(PORT);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
