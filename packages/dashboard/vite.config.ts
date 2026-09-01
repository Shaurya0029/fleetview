import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev-only proxy so the Vite dev server can talk to the locally running
// backend without CORS friction. In production the backend serves this
// build's static output directly (PRD §4.1) — no proxy needed there.
const BACKEND = process.env.VITE_BACKEND_HTTP ?? "http://localhost:8080";
const BACKEND_WS = process.env.VITE_BACKEND_WS ?? "ws://localhost:8080";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
  },
  server: {
    proxy: {
      "/robots": BACKEND,
      "/config": BACKEND,
      "/metrics": BACKEND,
      "/admin": BACKEND,
      "/healthz": BACKEND,
      "/stream": { target: BACKEND_WS, ws: true },
    },
  },
});
