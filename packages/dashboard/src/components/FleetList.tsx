import { useMemo, useRef, useState } from "react";
import type { RobotState } from "@waypoint/shared";
import { STATUS_STYLE, batteryColor } from "../palette";
import { useThrottledFleetSnapshot } from "../state/fleetStore";

type SortKey = "robot_id" | "status" | "battery";

const ROW_HEIGHT = 40;
const OVERSCAN = 6;

function sortRobots(robots: RobotState[], key: SortKey): RobotState[] {
  const copy = [...robots];
  copy.sort((a, b) => {
    if (key === "battery") return a.battery - b.battery;
    if (key === "status") return a.status.localeCompare(b.status);
    return a.robot_id.localeCompare(b.robot_id, undefined, { numeric: true });
  });
  return copy;
}

export function FleetList({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) {
  const { robots } = useThrottledFleetSnapshot(400);
  const [search, setSearch] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("robot_id");
  const [scrollTop, setScrollTop] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = robots;
    if (attentionOnly) list = list.filter((r) => r.needs_attention);
    if (q) list = list.filter((r) => r.robot_id.toLowerCase().includes(q) || r.robot_type.toLowerCase().includes(q));
    return sortRobots(list, sortKey);
  }, [robots, search, attentionOnly, sortKey]);

  const attentionCount = useMemo(() => robots.filter((r) => r.needs_attention).length, [robots]);

  const viewportHeight = viewportRef.current?.clientHeight ?? 400;
  const totalHeight = filtered.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(filtered.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);
  const visible = filtered.slice(startIndex, endIndex);

  return (
    <div className="fleet-list">
      <div className="fleet-list__toolbar">
        <input
          className="fleet-list__search"
          placeholder="Search robots…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="fleet-list__sort" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
          <option value="robot_id">Sort: ID</option>
          <option value="status">Sort: Status</option>
          <option value="battery">Sort: Battery</option>
        </select>
      </div>
      <div className="fleet-list__tabs">
        <button className={attentionOnly ? "" : "is-active"} onClick={() => setAttentionOnly(false)}>
          All ({robots.length})
        </button>
        <button className={attentionOnly ? "is-active" : ""} onClick={() => setAttentionOnly(true)}>
          Needs attention ({attentionCount})
        </button>
      </div>
      <div
        className="fleet-list__viewport"
        ref={viewportRef}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      >
        <div style={{ height: totalHeight, position: "relative" }}>
          {visible.map((r, i) => {
            const style = STATUS_STYLE[r.status];
            const idx = startIndex + i;
            return (
              <div
                key={r.robot_id}
                className={"fleet-row" + (r.robot_id === selectedId ? " is-selected" : "")}
                style={{ position: "absolute", top: idx * ROW_HEIGHT, height: ROW_HEIGHT }}
                onClick={() => onSelect(r.robot_id)}
              >
                <span className="fleet-row__dot" style={{ background: style.color, boxShadow: `0 0 6px ${style.color}99` }} />
                <span className="fleet-row__id">{r.robot_id}</span>
                <span className="fleet-row__type">{r.robot_type}</span>
                <span
                  className="fleet-row__status-pill"
                  style={{ color: style.color, background: `${style.color}22`, borderColor: `${style.color}55` }}
                >
                  {style.label}
                </span>
                <span className="fleet-row__battery tabular" style={{ color: batteryColor(r.battery) }}>
                  {r.battery.toFixed(0)}%
                </span>
                {r.needs_attention && <span className="fleet-row__flag" title={r.needs_attention_reasons.join(", ")}>⚠</span>}
              </div>
            );
          })}
          {filtered.length === 0 && <div className="fleet-list__empty">No robots match.</div>}
        </div>
      </div>
    </div>
  );
}
