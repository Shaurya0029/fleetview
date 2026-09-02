import type { ConnectionStatus } from "../state/fleetStore";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
  offline: "Offline",
};

const STATUS_TITLE: Record<ConnectionStatus, string> = {
  connecting: "Opening the connection to the backend.",
  live: "Streaming live telemetry from the backend over WebSocket.",
  reconnecting: "Connection dropped — retrying with backoff. The fleet view may be stale until this reconnects.",
  offline: "Not connected to the backend — this view is not live.",
};

export function Header({
  connectionStatus,
  fleetCount,
  onOpenControls,
}: {
  connectionStatus: ConnectionStatus;
  fleetCount: number;
  onOpenControls: () => void;
}) {
  return (
    <header className="header">
      <div className="header__brand">Waypoint</div>
      <div className={`header__conn header__conn--${connectionStatus}`} title={STATUS_TITLE[connectionStatus]}>
        <span className="header__conn-dot" />
        {STATUS_LABEL[connectionStatus]}
        {connectionStatus === "live" && <span className="muted"> ({fleetCount} robots)</span>}
      </div>
      <button className="header__gear" onClick={onOpenControls} title="Live controls">
        ⚙
      </button>
    </header>
  );
}
