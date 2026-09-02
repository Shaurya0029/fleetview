import { useEffect, useState } from "react";
import type { AdminConfigBody, BackendMetrics, RuntimeConfig } from "@waypoint/shared";

const TOKEN_STORAGE_KEY = "waypoint_admin_token";

export function LiveControls({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_STORAGE_KEY) ?? "");
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [metrics, setMetrics] = useState<BackendMetrics | null>(null);
  const [fleetSize, setFleetSize] = useState("");
  const [updateInterval, setUpdateInterval] = useState("");
  const [payloadBytes, setPayloadBytes] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [cfgRes, metRes] = await Promise.all([fetch("/config"), fetch("/metrics")]);
        const cfg = (await cfgRes.json()) as RuntimeConfig;
        setConfig(cfg);
        setFleetSize(String(cfg.fleet_size));
        setUpdateInterval(String(cfg.update_interval_ms));
        setPayloadBytes(String(cfg.payload_bytes));
        setMetrics((await metRes.json()) as BackendMetrics);
      } catch {
        setStatus("Could not reach backend for current config.");
      }
    };
    load();
    const id = setInterval(async () => {
      try {
        setMetrics((await (await fetch("/metrics")).json()) as BackendMetrics);
      } catch {
        // ignore transient poll failures
      }
    }, 3000);
    return () => clearInterval(id);
  }, []);

  const submit = async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    const body: AdminConfigBody = {
      fleet_size: Number(fleetSize),
      update_interval_ms: Number(updateInterval),
      payload_bytes: Number(payloadBytes),
    };
    setStatus("Applying…");
    try {
      const res = await fetch("/admin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setStatus(`Rejected (${res.status}): ${err.error ?? "unknown error"}`);
        return;
      }
      const applied = (await res.json()) as RuntimeConfig;
      setConfig(applied);
      setStatus("Applied — the simulator picks this up on its next poll (a few seconds).");
    } catch {
      setStatus("Request failed — is the backend reachable?");
    }
  };

  return (
    <div className="live-controls-overlay" onClick={onClose}>
      <div className="live-controls" onClick={(e) => e.stopPropagation()}>
        <div className="live-controls__header">
          <h2>Live controls</h2>
          <button className="live-controls__close" onClick={onClose}>
            ×
          </button>
        </div>

        <section>
          <h3>Backend health</h3>
          {metrics ? (
            <div className="metrics-grid tabular">
              <div><span>Ingest msgs/sec</span><b>{metrics.ingest_msgs_per_sec}</b></div>
              <div><span>Connected robots</span><b>{metrics.connected_robots}</b></div>
              <div><span>Connected dashboards</span><b>{metrics.connected_dashboards}</b></div>
              <div><span>Last tick duration</span><b>{metrics.last_tick_duration_ms}ms</b></div>
              <div><span>Last tick updated</span><b>{metrics.last_tick_updated_count}</b></div>
              <div><span>State map size</span><b>{metrics.state_map_size}</b></div>
            </div>
          ) : (
            <p className="muted">Loading…</p>
          )}
        </section>

        <section>
          <h3>Fleet configuration</h3>
          {config && (
            <p className="muted">
              Currently running: {config.fleet_size} robots · {config.update_interval_ms}ms interval ·{" "}
              {config.payload_bytes}B padding
            </p>
          )}
          <label title="Bearer token required to change config — find it in Render's Environment tab for this service">
            Admin token
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ADMIN_TOKEN" />
          </label>
          <label title="Number of simulated robots to run. Takes effect on the simulator's next config poll (a few seconds).">
            Fleet size
            <input type="number" min={0} value={fleetSize} onChange={(e) => setFleetSize(e.target.value)} />
          </label>
          <label title="How often each simulated robot reports in, in milliseconds. Lower = more messages/sec.">
            Update interval (ms)
            <input type="number" min={50} value={updateInterval} onChange={(e) => setUpdateInterval(e.target.value)} />
          </label>
          <label title="Pads each telemetry message to roughly this many bytes — useful for testing bandwidth under larger payloads.">
            Payload padding (bytes)
            <input type="number" min={0} value={payloadBytes} onChange={(e) => setPayloadBytes(e.target.value)} />
          </label>
          <button
            className="live-controls__submit"
            title="Push these values to the running backend immediately — no redeploy needed"
            onClick={submit}
          >
            Apply to live deployment
          </button>
          {status && <p className="live-controls__status">{status}</p>}
        </section>
      </div>
    </div>
  );
}
