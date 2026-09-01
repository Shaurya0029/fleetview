import path from "node:path";
import type { HistoryPoint, RobotStatus } from "@waypoint/shared";

/**
 * Stretch-goal persistence (PRD §7.4): SQLite backing store for robot
 * history beyond the in-memory ring buffer window. Chosen because it ships
 * inside the same deploy with no external service — if it disappeared we'd
 * lose history beyond the in-memory window, not live state (see FINDINGS.md).
 *
 * Loaded lazily and defensively: if better-sqlite3's native binding isn't
 * available in a given environment, persistence silently no-ops rather than
 * crashing the whole backend — live state and streaming are unaffected.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any = null;
let enabled = false;

try {
  const Database = (await import("better-sqlite3")).default;
  const dbPath = process.env.HISTORY_DB_PATH ?? path.join(process.cwd(), "waypoint-history.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      robot_id TEXT NOT NULL,
      t INTEGER NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      status TEXT NOT NULL,
      battery REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_history_robot_t ON history(robot_id, t);
  `);
  enabled = true;
} catch (err) {
  console.warn("[historyStore] SQLite persistence disabled:", (err as Error).message);
}

const insertStmt = enabled
  ? db.prepare(
      "INSERT INTO history (robot_id, t, x, y, status, battery) VALUES (?, ?, ?, ?, ?, ?)"
    )
  : null;

// better-sqlite3 is intentionally synchronous — one INSERT is fast, but one
// INSERT *per telemetry message* is not: a full fleet at a few thousand
// messages/sec turned the ingest path into a synchronous-disk-write path,
// which measurably stalled the whole event loop under load (see
// FINDINGS.md — this is a real bug the load test caught, not a
// theoretical one). Instead, appendHistory only queues in memory (O(1),
// matching the ingestion contract in PRD §9); a periodic flush writes
// everything queued since the last flush inside a single transaction, so
// disk I/O cost is paid once per interval, not once per message.
const FLUSH_INTERVAL_MS = 2000;
type QueuedPoint = { robotId: string; point: HistoryPoint };
let queue: QueuedPoint[] = [];

const insertMany = enabled
  ? db.transaction((rows: QueuedPoint[]) => {
      for (const { robotId, point } of rows) {
        insertStmt.run(robotId, point.t, point.x, point.y, point.status, point.battery);
      }
    })
  : null;

function flush(): void {
  if (!enabled || !insertMany || queue.length === 0) return;
  const batch = queue;
  queue = [];
  insertMany(batch);
}

if (enabled) {
  setInterval(flush, FLUSH_INTERVAL_MS).unref();
}

export function appendHistory(robotId: string, point: HistoryPoint): void {
  if (!enabled) return;
  queue.push({ robotId, point });
}

export function queryHistory(robotId: string, from?: number, to?: number): HistoryPoint[] {
  if (!enabled) return [];
  let sql = "SELECT t, x, y, status, battery FROM history WHERE robot_id = ?";
  const params: (string | number)[] = [robotId];
  if (from !== undefined) {
    sql += " AND t >= ?";
    params.push(from);
  }
  if (to !== undefined) {
    sql += " AND t <= ?";
    params.push(to);
  }
  sql += " ORDER BY t ASC";
  const rows = db.prepare(sql).all(...params) as Array<{
    t: number;
    x: number;
    y: number;
    status: RobotStatus;
    battery: number;
  }>;
  return rows;
}

export function isHistoryPersistenceEnabled(): boolean {
  return enabled;
}
