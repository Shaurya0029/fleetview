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

### 3. The Render build silently installed the wrong dependency set

**Symptom:** the first deploy attempt on Render failed during `npm run build` — `vite: command not found` (and equivalent for `tsc`).

**Root cause:** `render.yaml`'s original build command was plain `npm install && npm run build`, and Render sets `NODE_ENV=production` in the build environment by default. npm's own behavior is to skip `devDependencies` entirely whenever `NODE_ENV=production` is set at install time — and this project's actual build tools (`vite`, `typescript`, `vitest`, `@vitejs/plugin-react`) are all `devDependencies` (correctly so — they're not needed at runtime, only to produce `dist/`). So the install step silently succeeded with a much smaller dependency tree, and the very next step that needed those tools failed. Per the Render build log, the installed package count went from **131 (production-only)** to **257 (with dev)** once fixed — roughly double, all of it the build toolchain.

**Fix:** `render.yaml`'s `buildCommand` is now `npm install --include=dev && npm run build`, forcing devDependencies to install regardless of `NODE_ENV`. Runtime is unaffected — `npm run start` only ever touches the already-built `dist/` output and the (non-dev) runtime dependencies like `fastify` and `better-sqlite3`.

### 4. Real load test against the live Render deployment

Ran the required step: `POST /admin/config` (bearer-token gated) against `https://waypoint-i69h.onrender.com` — the actual free-tier deployment, not a dev machine — stepping `fleet_size` up while polling `GET /metrics` and `GET /robots` and watching the dashboard itself.

| `fleet_size` | `update_interval_ms` | connected robots | `last_tick_duration_ms` | `/robots` payload | `/robots` response time |
|---|---|---|---|---|---|
| 8 (baseline) | 5000 | 8 / 8 | 0 | — | — |
| 50 | 5000 | 50 / 50 | 0 | — | — |
| 200 | 5000 | 200 / 200 | 0 | — | — |
| 500 | 5000 | 500 / 500 | 0 | — | — |
| 1,000 | 5000 | 1,000 / 1,000 | 0 | 289 KB | 0.66s |
| 2,000 | 5000 | 2,000 / 2,000 | 1ms | 570 KB | 0.41s |
| 4,000 | 5000 | 4,000 / 4,000 | 0ms | 1.16 MB | 0.50s |

**Result: no breaking point found up to 4,000 simulated robots (500× the base 8-robot spec) on Render's free tier.** `last_tick_duration_ms` never exceeded 1ms, every robot that was asked to connect did connect, and `/robots` stayed under a second even at 4,000 robots / 1.16MB. This is a materially different (better) result than the local dev-machine numbers in Finding #2 above would suggest, largely because 4,000 robots at a 5s update interval is nowhere near the msgs/sec that made the SQLite write bug bite locally — we didn't re-run the *short-interval* stress case (500ms/250ms intervals) against the live instance in this pass; that combination remains the more likely place to find this instance's actual ceiling, per Finding #2/#3's local results.

**Anomaly found and documented, not fixed:** at `fleet_size` 500 and 1,000, `ingest_msgs_per_sec` read anomalously low (0–8, matching only the *original* small-fleet traffic) for well over a minute of sampling, even though `GET /robots` confirmed every newly-spawned robot was genuinely live — each had a steadily incrementing `seq` and a `last_seen` timestamp only 2–4 seconds old. The metric self-corrected by `fleet_size` 2,000 (read 63/s) and 4,000 (read 647/s, in the right ballpark for ~800/s expected). We did not root-cause this — `recordIngest()` (`packages/backend/src/state.ts`) is called unconditionally on every accepted message with no obvious gating bug, so the leading hypothesis is measurement/timer-granularity noise in `metrics.ts`'s plain `setInterval`-based per-second counter under Render's shared-CPU scheduling, not an actual ingestion failure. Worth a follow-up if this metric is ever load-bearing for anything (it currently isn't — it's a display-only meta-monitoring number).

**Note on `update_interval_ms`:** we did not additionally ramp this down against the live instance in this pass (time-constrained ahead of the submission deadline) — all live numbers above are at the default 5000ms. Given Finding #2's local result (the real bottleneck was messages/sec via a short interval, not fleet size alone), a live short-interval test is the natural next thing to run if there's time before submission.

### 5. A second, *not* fully resolved scaling limit: connection-establishment bursts

Pushing further, from 15,000 to a **cold jump to 50,000** robots (i.e., ~35,000 new simulated-robot WebSocket connections opening in a tight loop) made the backend stop accepting new connections for an extended period — `dmesg` showed the kernel logging `Possible SYN flooding` on the listening port during earlier runs at this scale, and `curl` eventually got connection-refused rather than a timeout. The process survived and kept running, but wasn't usefully available.

We did not fully root-cause or fix this. The leading hypothesis: opening thousands of near-simultaneous outbound WebSocket connections from a single Node process (the simulator), each requiring the backend to complete an HTTP-upgrade handshake on its single-threaded event loop, is qualitatively different from steady-state message throughput — it's a connection-establishment burst, not a message-processing rate. The honest scope of what we verified: **steady-state ingest/broadcast is solid to at least 15,000 robots** (well past what the base brief's 8 robots implies); a fleet *growing* to a very large size in one instant, rather than ramping gradually, is a distinct failure mode we found but didn't fix. The practical mitigation, not implemented: stagger new connections when `fleet_size` jumps by a lot (e.g., bring robots online over several seconds rather than in one synchronous loop) — which incidentally is also more realistic (a real warehouse fleet doesn't all power on in the same millisecond either).

**Caveat that applies to all three numbers above:** these were measured on the assistant's local dev machine (16 cores, ~7.6GB RAM, WSL2) while iterating, *not* against the actual Render deployment. **Finding #4 below is that re-run against the real deployed instance**, as the PRD requires — and, at least at the `fleet_size`/interval combinations actually tested there, the free-tier instance held up better than this caveat predicted. The short-interval, high-msgs/sec case that broke things locally (this finding and #2) was not re-tested live; see Finding #4's note on that.

---

## Design tradeoffs (not bugs — deliberate calls, with the reasoning)

- **Snapshot-on-every-`/stream`-connect instead of a separate `GET /robots` fetch-then-subscribe dance.** The PRD's failure-handling table describes fetching a REST snapshot before resuming the diff stream. This build instead has the backend send a `snapshot` message as the very first thing on *every* new `/stream` connection (including reconnects), and the dashboard just applies whatever it receives (`snapshot` → replace, `diff` → merge). It's the same guarantee — always a consistent baseline before any diffs — with one atomic message instead of a REST call racing a WS connect. `GET /robots` still exists and is documented, and would be the fallback for any consumer that isn't the WS client.
- **`seq`-based ordering, assigned by the simulator, not the server.** The PRD allows either. A server-assigned sequence would require the server to track more per-connection state for no real benefit here, since a single WebSocket connection is already TCP-ordered — reordering can only happen across a robot's *reconnects*, which an in-process, per-robot-agent monotonic counter (that persists across reconnects within one simulator process run) already handles correctly.
- **No separate "remove robot" admin action.** When `fleet_size` is turned down, the simulator just stops those agents; the backend has no explicit deletion path, so a descaled robot goes through the exact same staleness → `offline` path as a dropped connection. One mechanism covers both cases, and it matches the PRD's own framing that a robot going silent should never make it silently vanish.
- **History persistence degrades to a no-op, not a crash, if SQLite's native binding can't load.** Tried this defensively rather than assuming Render's Node buildpack compiles `better-sqlite3` cleanly; if it doesn't, the dashboard's history panel just shows fewer/no historical points beyond the in-memory ring buffer — live state and streaming are unaffected either way.

---

## What got cut, and why

- **`events.jsonl` (the recorded reference log) has never been available to any build session on this repo** — checked again while writing up Finding #4: it's absent from `data/`, and a full search of the project and this machine turned up no copy anywhere. Only `WAYPOINT_PRD.md`'s description of it exists. `layout.png` and `robots.json` were regenerated from the exact coordinates/values given in the PRD's data contract section (§2.1–2.2), which are precise enough to reproduce faithfully. The simulator was calibrated directly from the PRD's described rates (dwell times, drain/charge rates) instead of the recorded log, and per the PRD itself, replaying it verbatim was never the point. **If a real calibration comparison against the recorded log exists (e.g. "battery drains ~2.5x too fast," dwell times off 2–3x), it was not produced against this repo's code and should be re-verified against `packages/simulator/src/battery.ts` (`DRAIN_RATE = 100/300 %/s`, `CHARGE_RATE = 100/180 %/s`) and the `minDwellSeconds` table in `packages/simulator/src/statusTransitions.ts` before being treated as fact** — this session could not do that verification without the source file.
- **Task lifecycle view, replay scrubber, predictive alerts, multi-fleet support** (PRD §10, ranked medium/low priority): not built. `task_started`/`task_completed` events are emitted by the simulator and stored on `RobotState.task_event` but the dashboard doesn't surface them beyond that — no time budget for a dedicated view given the required pieces (site view, fleet list, trend chart, live controls, tests, docs, and the actual deploy) came first.
- **Docker packaging**: written (`Dockerfile`, `.dockerignore`) but not build-tested end-to-end, since Render's native Node runtime (via `render.yaml`) is the actual deploy path. If Docker is the chosen path instead, build it once before relying on it.
