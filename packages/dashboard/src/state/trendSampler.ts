import type { RobotStatus } from "@waypoint/shared";
import { STATUS_ORDER } from "../palette";
import { fleetStore } from "./fleetStore";

export interface TrendSample {
  ts: number;
  total: number;
  counts: Record<RobotStatus, number>;
}

const CAPACITY = 60 * 60; // 1 sample/sec, 1 hour — comfortably covers the 1m/5m/15m presets plus headroom

class TrendSampler {
  private samples: TrendSample[] = [];

  constructor() {
    setInterval(() => this.sampleNow(), 1000);
  }

  private sampleNow(): void {
    const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<RobotStatus, number>;
    let total = 0;
    for (const r of fleetStore.robots.values()) {
      counts[r.status] = (counts[r.status] ?? 0) + 1;
      total++;
    }
    this.samples.push({ ts: Date.now(), total, counts });
    if (this.samples.length > CAPACITY) this.samples.shift();
  }

  getSamples(): TrendSample[] {
    return this.samples;
  }
}

export const trendSampler = new TrendSampler();
