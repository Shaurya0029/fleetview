import { useState } from "react";
import { Header } from "./components/Header";
import { SiteView } from "./components/SiteView";
import { FleetList } from "./components/FleetList";
import { TrendChart } from "./components/TrendChart";
import { LiveControls } from "./components/LiveControls";
import { DetailPanel } from "./components/DetailPanel";
import { useFleetSocket } from "./hooks/useFleetSocket";
import { useThrottledFleetSnapshot } from "./state/fleetStore";

export function App() {
  useFleetSocket();
  const { robots, connectionStatus } = useThrottledFleetSnapshot(500);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [controlsOpen, setControlsOpen] = useState(false);

  return (
    <div className="app">
      <Header connectionStatus={connectionStatus} fleetCount={robots.length} onOpenControls={() => setControlsOpen(true)} />
      <div className="app__body">
        <div className="app__site">
          <SiteView selectedId={selectedId} onSelect={setSelectedId} />
        </div>
        <div className="app__side">
          <FleetList selectedId={selectedId} onSelect={setSelectedId} />
          {selectedId && <DetailPanel robotId={selectedId} onClose={() => setSelectedId(null)} />}
        </div>
      </div>
      <div className="app__trend">
        <TrendChart />
      </div>
      {controlsOpen && <LiveControls onClose={() => setControlsOpen(false)} />}
    </div>
  );
}
