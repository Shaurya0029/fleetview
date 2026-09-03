# Waypoint

A live fleet telemetry & operations dashboard for monitoring and managing a robot fleet in real time.

**Live dashboard:** https://waypoint-i69h.onrender.com
**Live backend health check:** https://waypoint-i69h.onrender.com/healthz
**Reviewer demo admin token:** `waypoint-demo-2026` — paste into the dashboard's gear icon → Live controls → Admin token to try changing fleet size / update interval / payload padding on the live deployment.

> Deployed on Render's free tier via the `render.yaml` blueprint. Load-tested against this exact live instance up to 4,000 simulated robots with no measurable degradation — see `FINDINGS.md`.

---

## What this is

Three pieces, one deployable service (see `ARCHITECTURE.md` for the full diagram and rationale):

1. **Simulator** (`packages/simulator`) — invents a fleet of robots and streams their position/battery/status over a WebSocket, in the exact shape a real robot would.
2. **Backend** (`packages/backend`) — Fastify server: ingests robot telemetry, holds the fleet's current state in memory, broadcasts batched diffs to dashboards, and serves the built dashboard as static files.
3. **Dashboard** (`packages/dashboard`) — React + Canvas control-room UI: live site view, searchable/filterable fleet list, zoomable trend chart.

The site map's six static zones are labeled as a generic fulfillment warehouse would be (storage by category, packing, shipping, a charging bay — see `packages/shared/src/warehouse.ts`), and a robot that's `on_mission`/`active` shows what it's currently carrying in its detail panel — illustrative, not modeled on any real company's actual facility.

In production these run as **one process** on Render: the backend serves the API/WebSockets and the dashboard's static build, and spawns the simulator as a real child process talking to itself over a real WebSocket (an actual network hop, not just a function call).

---

## Running it locally (Linux)

Requires Node.js 22+.

```bash
npm install
npm run build          # builds shared -> dashboard -> backend -> simulator, copies the dashboard build into packages/backend/public
ADMIN_TOKEN=devtoken PORT=8080 EMBED_SIMULATOR=true node packages/backend/dist/index.js
```

Open `http://localhost:8080`. That single command runs the backend, which spawns the simulator itself (since `EMBED_SIMULATOR=true`).

**For active development** (hot reload on all three, dashboard on its own Vite dev server proxying API calls to the backend):

```bash
npm run dev
```

This starts the backend (port 8080 by default), the simulator (as its own process, talking to that backend), and the dashboard's Vite dev server (default port 5173 — open that one in dev).

### Running the pieces independently

```bash
# backend only
ADMIN_TOKEN=devtoken PORT=8080 node packages/backend/dist/index.js

# simulator only, pointed at that backend
BACKEND_WS_URL=ws://localhost:8080/ingest BACKEND_HTTP_URL=http://localhost:8080 node packages/simulator/dist/index.js
```

### Tests

```bash
npm test
```

Covers the trickiest parts: the status state-machine's legality guarantees, the backend's out-of-order/staleness/attention logic, and the simulator's obstacle-avoiding pathfinder (see `FINDINGS.md` for what this caught).

---

## Config knobs

All are environment variables read by the **backend** at startup, and (for fleet size / update interval / payload size) live-adjustable afterward via `POST /admin/config` without a restart:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP/WS port (Render sets this automatically in production) |
| `ADMIN_TOKEN` | _(empty — admin endpoint rejects everything until set)_ | Bearer token required by `POST /admin/config` |
| `FLEET_SIZE` | `8` | Number of simulated robots |
| `UPDATE_INTERVAL_MS` | `5000` | How often each simulated robot publishes |
| `PAYLOAD_BYTES` | `0` | Pads each telemetry message to roughly this many bytes, for load-testing larger payloads |
| `EMBED_SIMULATOR` | `false` | If `true`, the backend spawns the simulator as its own child process (used in production; left off for `npm run dev`, which already runs the simulator as its own workspace process) |
| `BROADCAST_TICK_MS` | `350` | How often `/stream` gathers and sends a batched diff |
| `STALENESS_SWEEP_MS` | `2000` | How often the backend scans for robots that have gone silent |
| `EVICT_AFTER_MS` | `60000` | How much longer, on top of already being marked offline, a robot must stay silent before it's removed from state entirely (e.g. after `fleet_size` is turned down) — see `FINDINGS.md` |
| `HISTORY_DB_PATH` | `./waypoint-history.db` | SQLite file for the history stretch goal (see `ARCHITECTURE.md`) |

The **simulator**, when run as its own process (not embedded), reads `FLEET_SIZE` / `UPDATE_INTERVAL_MS` / `PAYLOAD_BYTES` as its own *initial* values but then polls the backend's `GET /config` every few seconds and reconciles to whatever the backend's live config says — so the backend's admin panel is always the source of truth for a running fleet, whichever way the simulator was started.

## Adjusting the live deployment

Click the ⚙ gear icon in the dashboard header. This opens a panel that:
- Shows current backend health (ingest rate, connected robots/dashboards, last broadcast tick duration, in-memory state size) — a live meta-monitoring view.
- Lets you change `fleet_size`, `update_interval_ms`, and `payload_bytes` on the **running** deployment, given the `ADMIN_TOKEN` (find its value in Render's Environment tab for this service, since `render.yaml` generates it — or set your own and redeploy).

This is the mechanism the brief asks for: turning fleet size and update frequency up on the *live* instance, no redeploy needed.

---

## Deploying

1. Push this repo to a GitHub repo (public, portfolio-safe — no secrets are committed; `ADMIN_TOKEN` is generated by Render itself per `render.yaml`).
2. On [Render](https://render.com), **New > Blueprint**, point it at the GitHub repo. `render.yaml` at the repo root defines the single web service (build command, start command, env vars, free plan).
3. Once live, copy the generated `ADMIN_TOKEN` value from the service's Environment tab in the Render dashboard — you'll need it for the live-controls panel.
4. Verify in a private/incognito browser window: the dashboard should show robots moving within a few seconds.

---

## AI delegation note

This project was built end-to-end in a single Claude Code session, working from a detailed PRD (`WAYPOINT_PRD.md`) that a prior planning session had already produced from the original challenge brief. Concretely:

- **AI-drafted, as-is:** all source code — simulator (motion/battery/status-machine/networking), backend (ingest/state/stream/routes/staleness/history), dashboard (all components, state stores, styling), tests, `render.yaml`, `Dockerfile`.
- **AI-drafted then verified by running it, not just reading it:** the whole pipeline was smoke-tested locally (backend + simulator over real WebSockets, live config resize, staleness → offline behavior) and the dashboard was driven in a real headless browser (Playwright) to check rendering, search/filter, canvas click-to-select, and the trend chart — not just unit tests. That process caught and fixed two real bugs before they'd have shipped: a CSS Grid layout bug (implicit `1fr` tracks sizing to content instead of the viewport, blowing the canvas out to ~4400px wide) and a genuine pathfinding bug (the obstacle-avoidance visibility graph was silently split into two disconnected halves at every rectangle, because a straight line between two corners of the *same* rectangle was flagged as blocked by that rectangle's own boundary — meaning robots would have routed straight through walls whenever a path needed to go around a corner). Both are described in `FINDINGS.md`.
- **Decisions the brief left open** (active vs. on_mission, picker vs. hauler motion profiles, what counts as "needs attention", server-side offline detection): made by the planning session that produced `WAYPOINT_PRD.md`, with reasoning recorded there in §3; this build followed them as given.
- **Render deployment and the load test against it** (§12 phase 4–5 of the PRD): the deployment itself was done from Shaurya's own Render account (this assistant has no such credentials). The load test — ramping `fleet_size` from 8 up to 4,000 against the live URL above via `POST /admin/config`, polling `/metrics` and `/robots` at each step — was run and verified by a Claude Code session with direct access to the live deployment. Numbers and the one real anomaly found (an under-reporting `ingest_msgs_per_sec` metric) are in `FINDINGS.md`.
