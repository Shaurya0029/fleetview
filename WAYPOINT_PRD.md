# Waypoint — Product Requirements & Build Spec

**Project:** Waypoint — a live fleet telemetry & operations dashboard
**Built for:** Peppermint Robotics, SDE-1 hiring challenge
**Author:** Shaurya
**Status:** Not started — this document is the spec to build from
**Deadline:** Thursday 3 Sep 2026, 11:59 PM IST
**Submit to:** kautilya.boga@peppermintrobotics.com, subject line exactly:
`SDE-1 Challenge | Shaurya | Full Stack`

> **Note to whichever Claude session picks this up:** this file is meant to be handed to you cold, with no other context. Everything you need to start building is in here: the problem, the data, the architecture, the exact API surface, the UI layout, the file structure, and the build order. Read the whole thing before writing code. Where a decision was ours to make (the brief leaves some things deliberately open), it's marked **Decision** and the reasoning is given — follow it, but you can push back if you find a better argument.

---

## 1. What this project actually is

Peppermint Robotics builds warehouse robots. This challenge asks us to build the software an operator would use to watch a whole fleet of them working, live, on one screen.

Concretely, three things, wired together:

1. **A simulator** — a program that pretends to be a fleet of real robots. Since we don't have physical hardware, this script invents robots and continuously reports their position, battery level, and current activity, in exactly the format a real robot would use.
2. **A backend** — a server that receives everything every simulated robot is saying, keeps track of the current state of the whole fleet, and makes that state available to whoever wants to watch it.
3. **A dashboard** — the actual webpage. This is what "the product" means here: a live, readable, browser-based control room view of the fleet.

The three pieces are a **producer → consumer → viewer** pipeline:

```
robot (simulated)  --publishes-->  backend  --streams-->  browser dashboard
      (producer)                 (ingest + state)              (viewer)
```

### Who this is for

The persona is a **fleet operator**: one person, responsible for anywhere from 8 to several thousand robots on a warehouse floor, who needs to answer three questions at a glance, at any moment: *Is the fleet basically okay right now? Is anything trending badly? Which specific robot needs my attention, and why?* Every UI decision below is in service of answering those three questions fast — not in service of looking impressive in a screenshot.

### Why this matters as a grading exercise (read this before optimizing anything else)

Peppermint is explicit: **they open the live URLs and use the running system before reading a single line of code.** A working system that's a bit rough beats a beautiful codebase behind a dead link. Bias every decision below toward "actually running, live, at deadline" over "theoretically more correct."

They also explicitly test at scale — turning fleet size and update frequency up well past 8 robots — so "looks fine with 8 robots, falls over at 500" is treated as a failure, not a partial success.

---

## 2. The data contract (given to us — do not redesign this)

This is fixed. The simulator must produce data in exactly this shape; the backend and dashboard must consume it as-is.

### 2.1 Site — `layout.png`

- 900 × 560 px image.
- Origin `(0,0)` is **top-left**. `x` increases right, `y` increases down (standard image/canvas coordinates — this matches HTML canvas natively, no flipping needed).
- 1 pixel = 1 unit of distance. No scale conversion.
- The image shows six grey rectangles, read as shelving/racking:
  - three short rows on the left (roughly `x:150–340`, at `y≈80–140`, `y≈220–280`, `y≈360–420`)
  - one tall rack down the center (roughly `x:500–565`, `y:60–460`)
  - two rows on the right (roughly `x:650–850`, at `y≈150–210` and `y≈335–395`)
- These rectangles are **obstacles**: robots must not path through them, and the dashboard should render them as static context under the moving robots.

### 2.2 Roster — `robots.json`

Array of robot objects:

```json
{
  "robot_id": "r1",
  "robot_type": "picker",
  "start": { "x": 569.9, "y": 33.0 }
}
```

- 8 robots given (`r1`–`r8`), alternating `picker` / `hauler`.
- This is a **starting point, not a ceiling** — the simulator must be able to generate fleets of any configured size, either by extending this roster pattern or inventing new robots entirely.

### 2.3 Telemetry — `events.jsonl`

Recorded 15-minute log (900 seconds), ~5s cadence per robot, one JSON object per line:

```json
{"t": 0, "robot_id": "r2", "x": 787.3, "y": 65.2, "status": "idle", "battery": 75.8}
```

| Field | Type | Notes |
|---|---|---|
| `t` | int | Seconds since window start, `0`–`900` |
| `robot_id` | string | Matches roster |
| `x`, `y` | float | Site coordinates |
| `status` | enum | `idle \| active \| on_mission \| charging \| blocked \| error \| maintenance \| offline` |
| `battery` | float | Percentage, `0`–`100` |
| `task_event` | string, optional | Rare, may appear unpaired: `task_started` or `task_completed`. **Not graded** — surface it or ignore it. |

This recorded log is a reference for what "plausible" looks like (movement continuity, status transition rates, battery drain/charge rates). **Replaying it verbatim is explicitly optional and not the point** — the simulator should generate its own live data matching this contract, not play back this file.

---

## 3. Decisions the brief leaves open (and what we're deciding)

The brief deliberately does not define these. It says: make a sensible call, be ready to defend it. Here's the call, and the reasoning, for each:

**Decision — `active` vs `on_mission`.**
`active` = the robot is doing autonomous work not tied to a dispatched task (repositioning, patrolling toward a general area). `on_mission` = the robot is executing a specific dispatched task with an implicit task id, and is what the rare `task_started` / `task_completed` events bracket when present. Reasoning: this gives the two statuses a real, distinguishable meaning instead of being synonyms, and ties `on_mission` concretely to the `task_event` field the data contract already has.

**Decision — `picker` vs `hauler` behavior.**
`picker` robots move in short, frequent hops, concentrated near the shelving rows (slower, more start-stop — matches picking items off a shelf). `hauler` robots make longer, straighter runs through the open aisles and the central corridor (faster, fewer stops — matches point-to-point transport). Reasoning: gives the simulator two visually distinguishable motion profiles instead of one generic "robot," which also makes the dashboard's live view more legible and more obviously "real."

**Decision — what counts as "needs attention."**
A robot needs attention if: status is `error`, `blocked`, or `offline` (always) — **or** `battery < 15%` while status is not `charging`. `maintenance` counts as needing attention only if it's still in that status past its own expected duration (i.e. *stuck* in maintenance). Reasoning: ties "needs attention" to conditions an operator would actually want paged on, not every non-`idle` status.

**Decision — offline detection is server-side, not self-reported.**
A robot is not trusted to announce its own disconnect. If the backend hasn't received an update for a given robot within `3 × update_interval`, the backend marks that robot `offline` itself and stamps a `last_seen` timestamp. Reasoning: this is what makes a dropped connection actually show up on the dashboard instead of the last-known state freezing silently — directly addresses the brief's "flaky networks" requirement.

---

## 4. Architecture

### 4.1 Principle

**One language, one deployable service.** Everything is TypeScript, running on Node.js. The simulator, backend, and dashboard all live in one repo. In production, **one process** serves the backend API/streams *and* the built dashboard as static files — so there's exactly one URL, one thing to keep alive on a free hosting tier, and no CORS surface to secure. The simulator runs as a child process of that same deploy, talking to the backend over a real WebSocket connection — so the producer/consumer split is real (an actual network hop), not just a comment in the code.

### 4.2 Data flow, publish → pixel

**In one sentence:** a simulated robot opens a WebSocket to `/ingest` and sends a small JSON message every `update_interval` ms; the backend does an O(1) upsert of that robot's row into an in-memory map (never queuing, never blocking); on a fixed independent tick, the backend gathers whatever changed since the last tick and broadcasts one batched diff to every connected dashboard over `/stream`; the dashboard receives that diff and updates the exact pixels for the robots that moved, without re-rendering anything else.

### 4.3 Failure handling (required by the brief — design for these explicitly)

| Failure | Handling |
|---|---|
| Robot's connection drops | Simulator reconnects with exponential backoff + jitter. Backend's staleness sweep marks the robot `offline` after `3× update_interval` of silence, regardless of whether a clean disconnect was received. |
| Dashboard's connection drops | Dashboard client reconnects with backoff. On reconnect, it first fetches `GET /robots` for a full current snapshot, *then* resumes consuming the `/stream` diff feed. |
| Backend is slow to send to one dashboard client | Backend checks each client's outbound buffer before sending; a backed-up client gets that tick's frame skipped, never blocking the broadcast for other clients. |
| Burst of robot updates | Because ingestion is an O(1) map upsert (not a queue), a burst can only ever cost one write per message — there's no backlog that can build up and stall. |
| Updates arrive late or out of order | Each state upsert compares the incoming event's `t` (or a server-assigned monotonic sequence) against the currently stored value for that robot and discards updates older than what's already stored. |
| A robot "dies" mid-task | If a robot goes `offline` while `on_mission`, the backend leaves its last-known task context attached. |

---

## 5. Languages & tech stack

Everything is TypeScript across simulator (Node + `ws`), backend (Fastify + `@fastify/websocket`), dashboard (React + Vite + Canvas), trend chart (canvas-based), persistence stretch (SQLite via `better-sqlite3`), hosting (Render.com free tier).

---

## 6. The simulator, in detail

Config via env vars: `FLEET_SIZE` (default 8), `UPDATE_INTERVAL_MS` (default 5000), `PAYLOAD_BYTES`, `BACKEND_WS_URL`.

Per-robot agent: waypoint-seeking motion routing around the six obstacle rectangles; picker vs hauler motion profiles; battery drains while active/on_mission, holds while idle/blocked/maintenance, climbs while charging; status state machine with legal transitions only and realistic dwell times; WS connection with exponential backoff + jitter on disconnect.

---

## 7. The backend, in detail

`WS /ingest` — O(1) upsert per message, no queue.
`WS /stream` — batched diff broadcast on a fixed tick (250–500ms), per-client backpressure check.
`GET /robots` — full snapshot, same state map as `/stream`.
`GET /robots/history/:robot_id?from&to` — stretch, ring buffer + SQLite.
`POST /admin/config` — bearer-token gated, live fleet_size/update_interval_ms changes without redeploy.
Staleness sweep — periodic scan, mark offline after `3× update_interval` silence.
Consistency rule — `/stream` and `/robots` read the same state map.

---

## 8. The dashboard, in detail

Single-screen layout: site view (canvas, layout.png backdrop, robots as colored dots, needs-attention ring/pulse, never color-only), fleet list (right, searchable/sortable/virtualized, "needs attention" filter), trend chart (bottom, zoomable/pannable stacked time series of fleet status composition), header (connection status, fleet size, live-controls gear).

Status palette: idle=grey, active=blue, on_mission=teal/accent, charging=green, blocked=amber(attn), error=red(attn), maintenance=purple(attn if stuck), offline=dark grey/hatched(attn).

Dark, low-glare, tabular-numeral control-room visual tone. Resilient to disconnects: visible reconnecting state, re-snapshot on reconnect, never crash on a malformed robot row.

---

## 9. Non-functional requirements (the scale story)

O(1) ingestion, tick-based batched fan-out, canvas + virtualized rendering, real load-tested numbers in FINDINGS.md gathered against the actual deployed instance with FLEET_SIZE/UPDATE_INTERVAL_MS turned up.

---

## 10. Stretch ideas beyond the base brief

High value: meta-monitoring panel (msgs/sec, tick duration, connection counts), congestion heatmap overlay, structured logging.
Medium: task lifecycle view, replay scrubber, basic rate limiting on /ingest.
Lower priority: predictive alerts, multi-fleet/site, full auth system.

---

## 11. Repository structure

```
waypoint/
├── WAYPOINT_PRD.md
├── README.md
├── FINDINGS.md
├── ARCHITECTURE.md
├── packages/
│   ├── shared/
│   ├── simulator/
│   ├── backend/
│   └── dashboard/
├── data/
├── tests/
├── Dockerfile
└── package.json
```

---

## 12. Build order

1. Scaffold — repo structure, shared TS types, obstacle rectangles from layout.png.
2. Simulator + backend locally — real WS traffic, ingestion, state map, ring buffers, /stream, /robots, staleness sweep, config knobs.
3. Dashboard — site view, fleet list, trend chart, reconnect handling, wired to local backend.
4. Deploy — Render, one service, /admin/config + live-controls panel, private-window verification.
5. Load test the live deployment — turn FLEET_SIZE/UPDATE_INTERVAL_MS up, record real degradation numbers for FINDINGS.md.
6. Stretch + tests + docs + submit.

---

## 13. Deliverables checklist

- [ ] Live dashboard URL, verified in a private browser window
- [ ] Live backend surface URL, verified independently
- [ ] Source — git repo (public, portfolio-safe) or archive
- [ ] README.md — live URLs first, config knobs, live-control instructions, Linux run steps, AI delegation notes
- [ ] FINDINGS.md — real tradeoffs, observed degradation with real numbers, what got cut and why
- [ ] ARCHITECTURE.md — diagram, publish-to-pixel walkthrough, failure handling, "what changes at 10x fleet size"
- [ ] Tests for the trickiest part
- [ ] Email to kautilya.boga@peppermintrobotics.com, exact subject line, links first

---

## 14. AI delegation note (required content for the README later)

Per the brief: "note in your README which parts you delegated to AI. AI use is not penalized; inability to explain any part of your own submission is." Keep a running note as this gets built of what was AI-drafted vs. hand-written vs. AI-drafted-then-hand-corrected, so README.md's AI delegation section is accurate rather than reconstructed from memory at the end.
