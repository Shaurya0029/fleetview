import { useEffect, useState } from "react";
import type { HistoryPoint } from "@waypoint/shared";
import { STATUS_STYLE } from "../palette";
import { useThrottledFleetSnapshot } from "../state/fleetStore";

function timeAgo(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export function DetailPanel({ robotId, onClose }: { robotId: string; onClose: () => void }) {
  const { robots } = useThrottledFleetSnapshot(400);
  const robot = robots.find((r) => r.robot_id === robotId);
  const [history, setHistory] = useState<HistoryPoint[] | null>(null);

  useEffect(() => {
    setHistory(null);
    fetch(`/robots/history/${encodeURIComponent(robotId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setHistory(data?.points ?? []))
      .catch(() => setHistory([]));
  }, [robotId]);

  if (!robot) {
    return (
      <div className="detail-panel">
        <div className="detail-panel__header">
          <span>{robotId}</span>
          <button onClick={onClose}>×</button>
        </div>
        <p className="muted">No longer reporting.</p>
      </div>
    );
  }

  const style = STATUS_STYLE[robot.status];
  const batteries = (history ?? []).map((p) => p.battery);
  const minBattery = batteries.length ? Math.min(...batteries) : robot.battery;
  const maxBattery = batteries.length ? Math.max(...batteries) : robot.battery;

  return (
    <div className="detail-panel">
      <div className="detail-panel__header">
        <span>
          {robot.robot_id} <span className="muted">· {robot.robot_type}</span>
        </span>
        <button onClick={onClose}>×</button>
      </div>
      <div className="detail-panel__row">
        <span className="detail-panel__status-dot" style={{ background: style.color }} />
        {style.label}
        {robot.needs_attention && (
          <span className="detail-panel__attention"> — needs attention: {robot.needs_attention_reasons.join(", ")}</span>
        )}
      </div>
      <div className="detail-panel__grid tabular">
        <div><span>Battery</span><b>{robot.battery.toFixed(1)}%</b></div>
        <div><span>Position</span><b>{robot.x.toFixed(1)}, {robot.y.toFixed(1)}</b></div>
        <div><span>Last seen</span><b>{timeAgo(robot.last_seen)}</b></div>
        <div><span>In status for</span><b>{timeAgo(robot.status_since).replace(" ago", "")}</b></div>
      </div>
      {robot.last_mission_context && (
        <p className="muted">Last seen mid-mission at {new Date(robot.last_mission_context.at).toLocaleTimeString()}.</p>
      )}
      <div className="detail-panel__history">
        {history === null ? (
          <p className="muted">Loading recent history…</p>
        ) : history.length === 0 ? (
          <p className="muted">No recorded history yet.</p>
        ) : (
          <p className="muted">
            {history.length} samples · battery {minBattery.toFixed(0)}–{maxBattery.toFixed(0)}%
          </p>
        )}
      </div>
    </div>
  );
}
