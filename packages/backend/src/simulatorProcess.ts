import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Spawns the simulator as a real child process talking to this backend over
 * a real WebSocket connection (PRD §4.1) — so on a single-service deploy
 * (one Render web service, one URL) the producer/consumer split is an
 * actual network hop, not just a comment in the code. Gated behind
 * EMBED_SIMULATOR so local `npm run dev` (which already runs the simulator
 * as its own workspace process) doesn't end up running two copies.
 */
export function startEmbeddedSimulatorIfEnabled(port: number): void {
  if (process.env.EMBED_SIMULATOR !== "true") return;

  const simulatorEntry = path.join(__dirname, "..", "..", "simulator", "dist", "index.js");

  const spawnChild = () => {
    const child = spawn(process.execPath, [simulatorEntry], {
      env: {
        ...process.env,
        BACKEND_WS_URL: `ws://127.0.0.1:${port}/ingest`,
        BACKEND_HTTP_URL: `http://127.0.0.1:${port}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (d: Buffer) => process.stdout.write(`[simulator] ${d}`));
    child.stderr.on("data", (d: Buffer) => process.stderr.write(`[simulator:err] ${d}`));
    child.on("exit", (code) => {
      console.warn(`[simulator] exited (code ${code}) — restarting in 2s`);
      setTimeout(spawnChild, 2000);
    });
  };

  spawnChild();
}
