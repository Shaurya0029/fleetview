import type { FastifyInstance } from "fastify";
import { getAllRobots, getRecentHistory } from "../state.js";
import { queryHistory } from "../historyStore.js";
import type { HistoryPoint } from "@waypoint/shared";

export function registerRobotRoutes(app: FastifyInstance): void {
  // Full current snapshot — reads the same state map /stream reads, so the
  // two surfaces can never disagree (PRD §7.7).
  app.get("/robots", async () => {
    return { ts: Date.now(), robots: getAllRobots() };
  });

  app.get<{
    Params: { robot_id: string };
    Querystring: { from?: string; to?: string };
  }>("/robots/history/:robot_id", async (req, reply) => {
    const { robot_id } = req.params;
    const from = req.query.from !== undefined ? Number(req.query.from) : undefined;
    const to = req.query.to !== undefined ? Number(req.query.to) : undefined;

    // Prefer the in-memory ring buffer (recent, cheap); fall back to SQLite
    // for anything older, deduping by `t` since the two can overlap.
    const recent = getRecentHistory(robot_id, from, to);
    const older = queryHistory(robot_id, from, to);

    const seenT = new Set(recent.map((p) => p.t));
    const merged: HistoryPoint[] = [...older.filter((p) => !seenT.has(p.t)), ...recent].sort(
      (a, b) => a.t - b.t
    );

    if (merged.length === 0) {
      reply.code(404);
      return { error: "no history for robot_id" };
    }
    return { robot_id, points: merged };
  });
}
