import type { RobotStatus } from "@waypoint/shared";

export interface StatusStyle {
  color: string;
  label: string;
  needsAttentionCapable: boolean;
}

// Status color palette (PRD §8.3) — kept deliberately distinct from the
// app's own accent color (see index.css --accent) so "this robot needs
// help" is never confused with "this button is clickable". Attention is
// also encoded non-color (a ring/pulse in SiteView, an icon in FleetList),
// per the "never rely on color alone" accessibility requirement.
export const STATUS_STYLE: Record<RobotStatus, StatusStyle> = {
  idle: { color: "#8b93a1", label: "Idle", needsAttentionCapable: false },
  active: { color: "#4d8dff", label: "Active", needsAttentionCapable: false },
  on_mission: { color: "#2dd4bf", label: "On mission", needsAttentionCapable: false },
  charging: { color: "#4ade80", label: "Charging", needsAttentionCapable: false },
  blocked: { color: "#f5a623", label: "Blocked", needsAttentionCapable: true },
  error: { color: "#f04747", label: "Error", needsAttentionCapable: true },
  maintenance: { color: "#a78bfa", label: "Maintenance", needsAttentionCapable: true },
  offline: { color: "#5b6472", label: "Offline", needsAttentionCapable: true },
};

export const STATUS_ORDER: RobotStatus[] = [
  "idle",
  "active",
  "on_mission",
  "charging",
  "blocked",
  "error",
  "maintenance",
  "offline",
];

export const ATTENTION_RING_COLOR = "#ffffff";

export function batteryColor(pct: number): string {
  if (pct < 15) return "#f87171";
  if (pct < 40) return "#fbbf24";
  return "#4ade80";
}
