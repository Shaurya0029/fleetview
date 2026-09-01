# Findings

## Real bugs the process caught (not theoretical — reproduced, root-caused, fixed, verified)

### 1. The obstacle-avoidance pathfinder was silently splitting the site in half

**Symptom:** a unit test asserting "the path from A to B never crosses an obstacle rectangle" failed for straight lines that had to route *around* a rectangle, but passed for lines that didn't need to.

**Root cause:** the simulator's motion planner builds a visibility graph over the corners of the 6 obstacle rectangles, then Dijkstra's over it. Corner nodes were placed exactly *on* each rectangle's bounding-box corner. A straight line between, say, a rectangle's top-left and top-right corner runs exactly along that rectangle's own top edge — which the (correct, inclusive-bounds) intersection test flags as "blocked by this rectangle," since the line touches its boundary. That's fine in isolation, but it meant a rectangle's own corners could never see *each other*, which severed the only edges that would otherwise let a path go from one side of an obstacle to the other. Checking actual connectivity confirmed it: the 24-node graph split into two disconnected components of 14 and 10 nodes, right at the site's central rack.

**Effect if shipped:** the "fall back to a direct line" safety net I'd written for the disconnected case (`findPath`'s `distTo[goal] === Infinity` branch) would have silently kicked in for every one of these cases — meaning robots would have routed **straight through walls** whenever a path needed to bend around a corner, which is most of the site given the central rack. This would not have been visually obvious in a quick look at 8 robots (short hops mostly stay on one side), but would have become obvious and embarrassing at the scale the grading explicitly tests.

**Fix:** nudge each corner node ~1.5px outside its rectangle along the outward diagonal, so a line between two corners of the *same* rectangle runs just outside it rather than along its boundary — the standard trick for corner-based visibility graphs. Verified with `tests/motion.test.ts` (5 start/goal pairs, each requiring a real detour) and an end-to-end check polling the live running simulator's reported positions for 30s / 150 samples, confirming zero robots ever land inside an obstacle.

### 2. Synchronous per-message SQLite writes stalled the whole backend under load

**Symptom:** load-testing the deployed... well, the *local*, pre-deployment build (see caveat below) by ramping `fleet_size` up via `POST /admin/config`: at 500–2,000 robots, everything was instant. Cold-starting straight at 5,000 robots (500ms update interval → 10,000 msgs/sec) made the backend stop responding to *every* HTTP route, including `/healthz` — which does nothing but return a static object. The process wasn't crashed (`ps` still showed it running, burning CPU), just completely unresponsive, and its process state was `D` (uninterruptible sleep / disk wait) rather than pegged CPU.

**Root cause:** `appendHistory()` was called once per accepted telemetry message and did a synchronous `INSERT` into SQLite via `better-sqlite3` (synchronous by design). At 10,000 messages/sec, that's 10,000 individual transactions/sec, each paying B-tree index-maintenance and journal overhead. The history DB file had grown to **415MB in about two minutes** — far more than the actual data volume justified, confirming per-row transaction overhead was the dominant cost, not the data itself.

**Fix:** `appendHistory()` now only pushes into an in-memory queue (O(1), matching the ingestion contract in PRD §9); a `setInterval` every 2s flushes the whole queue inside one `db.transaction()`. Disk I/O cost is now paid once per interval instead of once per message.

**Verified before/after, same test, same machine:**

| Scenario | Before fix | After fix |
|---|---|---|
| Cold start, 5,000 robots, 500ms interval (10k msgs/sec) | `/healthz` and every other route unresponsive for 30s+ (gave up waiting) | Responsive within 5s; `last_tick_duration_ms` 4–13ms throughout |
| Ramped to 15,000 robots, 250ms interval (60k–128k msgs/sec, includes reconnect bursts) | not tested (already broken at 5k) | Stayed responsive; `last_tick_duration_ms` 23–31ms |

This is the clearest single example in this project of the load test doing its job: the steady-state ingest/broadcast path was fine (and had already been measured fine at 2,000 robots), but a completely different part of the system — a stretch-goal feature — was the actual bottleneck, and it wouldn't have been found without actually turning the numbers up.

### 3. A second, *not* fully resolved scaling limit: connection-establishment bursts

Pushing further, from 15,000 to a **cold jump to 50,000** robots (i.e., ~35,000 new simulated-robot WebSocket connections opening in a tight loop) made the backend stop accepting new connections for an extended period — `dmesg` showed the kernel logging `Possible SYN flooding` on the listening port during earlier runs at this scale, and `curl` eventually got connection-refused rather than a timeout. The process survived and kept running, but wasn't usefully available.

We did not fully root-cause or fix this. The leading hypothesis: opening thousands of near-simultaneous outbound WebSocket connections from a single Node process (the simulator), each requiring the backend to complete an HTTP-upgrade handshake on its single-threaded event loop, is qualitatively different from steady-state message throughput — it's a connection-establishment burst, not a message-processing rate. The honest scope of what we verified: **steady-state ingest/broadcast is solid to at least 15,000 robots** (well past what the base brief's 8 robots implies); a fleet *growing* to a very large size in one instant, rather than ramping gradually, is a distinct failure mode we found but didn't fix. The practical mitigation, not implemented: stagger new connections when `fleet_size` jumps by a lot (e.g., bring robots online over several seconds rather than in one synchronous loop) — which incidentally is also more realistic (a real warehouse fleet doesn't all power on in the same millisecond either).

**Caveat that applies to all three numbers above:** these were measured on the assistant's local dev machine (16 cores, ~7.6GB RAM, WSL2) while iterating, *not* against the actual Render deployment, which this session could not create (no GitHub/Render account access — see `README.md`). Render's free tier has meaningfully less CPU/RAM than this dev machine, and WSL2's virtualized networking may itself exaggerate the connection-burst finding above. **Whoever deploys this should re-run the same ramp (`FLEET_SIZE`/`UPDATE_INTERVAL_MS` via the live-controls panel) against the real deployed instance and replace these numbers** — the PRD is explicit that this is a required step, not optional, and the actual ceiling on a free-tier instance will almost certainly be lower than what's measured here.

---

## Design tradeoffs (not bugs — deliberate calls, with the reasoning)

- **Snapshot-on-every-`/stream`-connect instead of a separate `GET /robots` fetch-then-subscribe dance.** The PRD's failure-handling table describes fetching a REST snapshot before resuming the diff stream. This build instead has the backend send a `snapshot` message as the very first thing on *every* new `/stream` connection (including reconnects), and the dashboard just applies whatever it receives (`snapshot` → replace, `diff` → merge). It's the same guarantee — always a consistent baseline before any diffs — with one atomic message instead of a REST call racing a WS connect. `GET /robots` still exists and is documented, and would be the fallback for any consumer that isn't the WS client.
- **`seq`-based ordering, assigned by the simulator, not the server.** The PRD allows either. A server-assigned sequence would require the server to track more per-connection state for no real benefit here, since a single WebSocket connection is already TCP-ordered — reordering can only happen across a robot's *reconnects*, which an in-process, per-robot-agent monotonic counter (that persists across reconnects within one simulator process run) already handles correctly.
- **No separate "remove robot" admin action.** When `fleet_size` is turned down, the simulator just stops those agents; the backend has no explicit deletion path, so a descaled robot goes through the exact same staleness → `offline` path as a dropped connection. One mechanism covers both cases, and it matches the PRD's own framing that a robot going silent should never make it silently vanish.
- **History persistence degrades to a no-op, not a crash, if SQLite's native binding can't load.** Tried this defensively rather than assuming Render's Node buildpack compiles `better-sqlite3` cleanly; if it doesn't, the dashboard's history panel just shows fewer/no historical points beyond the in-memory ring buffer — live state and streaming are unaffected either way.

---

## What got cut, and why

- **`events.jsonl` (the recorded reference log) was never provided to this build session** — only `WAYPOINT_PRD.md`'s description of it. `layout.png` and `robots.json` were regenerated from the exact coordinates/values given in the PRD's data contract section (§2.1–2.2), which are precise enough to reproduce faithfully. The recorded telemetry log's exact contents weren't available and, per the PRD itself, replaying it verbatim was never the point — the simulator was calibrated directly from the described rates (dwell times, drain/charge rates) instead. If the real file is available, it'd be worth a follow-up pass comparing its actual status-dwell distribution against `EXPECTED_DWELL_SECONDS` in `packages/shared/src/statusMachine.ts`.
- **Task lifecycle view, replay scrubber, predictive alerts, multi-fleet support** (PRD §10, ranked medium/low priority): not built. `task_started`/`task_completed` events are emitted by the simulator and stored on `RobotState.task_event` but the dashboard doesn't surface them beyond that — no time budget for a dedicated view given the required pieces (site view, fleet list, trend chart, live controls, tests, docs, and the actual deploy) came first.
- **Congestion/heatmap overlay** (PRD §10, ranked high value): not built, despite being cheap to justify — cut in favor of finishing the required deliverables and load-testing pass with the time available.
- **Docker packaging**: written (`Dockerfile`, `.dockerignore`) but not build-tested end-to-end in this session, since Render's native Node runtime (via `render.yaml`) is the actual deploy path. If Docker is the chosen path instead, build it once before relying on it.
- **The actual Render deployment and a load test against it**: not done in this session — this needs a GitHub/Render account this assistant doesn't have access to. See `README.md`'s placeholder and **Deploying** section.
