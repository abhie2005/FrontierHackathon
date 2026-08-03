/**
 * Express API — exposes FalkorDB reads/writes and the full pipeline to a
 * frontend. Keeps one persistent FalkorDB connection for the server's
 * lifetime instead of reconnecting per request.
 *
 *   POST /api/trigger          run the full pipeline for a TriggerEvent
 *   GET  /api/events           SSE stream of live PipelineEvents
 *   GET  /api/decisions/:hub   ShipmentDecision history for a hub (memory)
 *   GET  /api/health           FalkorDB connectivity check
 *
 * Run:  npm run server   (PORT env var optional, defaults to 4000 —
 *        3000 is taken by the FalkorDB Browser UI, see docker-compose.yml)
 */
import "./load-env.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response } from "express";
import { connect } from "./falkordb/client.js";
import { listDecisions } from "./falkordb/memory.js";
import { runPipeline } from "./pipeline.js";
import { consoleEmitter, multi, type EmitFn, type PipelineEvent } from "./agents/events.js";
import type { TriggerEvent } from "./types.js";

const PORT = Number(process.env.PORT ?? 4000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "../public");

const app = express();
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});
app.options("*", (_req, res) => res.sendStatus(204));
app.use(express.static(PUBLIC_DIR));

// One FalkorDB connection for the whole server lifetime.
const { graph } = await connect();

// SSE broadcast bus — every connected client gets every pipeline event.
let sseClients: Response[] = [];
function broadcast(event: Omit<PipelineEvent, "ts">) {
  const payload: PipelineEvent = { ...event, ts: Date.now() };
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  sseClients.forEach((res) => res.write(line));
}
const sseEmitter: EmitFn = (e) => broadcast(e);
const emit = multi(consoleEmitter, sseEmitter);

app.get("/api/events", (req: Request, res: Response) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("\n");
  sseClients.push(res);
  req.on("close", () => {
    sseClients = sseClients.filter((c) => c !== res);
  });
});

app.post("/api/trigger", async (req: Request, res: Response) => {
  const trigger = req.body as TriggerEvent;
  if (!trigger?.hub || !trigger?.product || !trigger?.demand_multiplier) {
    res.status(400).json({ ok: false, error: "Body must include hub, product, demand_multiplier" });
    return;
  }
  try {
    const { decision, result } = await runPipeline(trigger, emit);
    res.json({ ok: true, decision, result });
  } catch (err) {
    emit({ source: "system", label: `Pipeline error: ${(err as Error).message}` });
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/api/decisions/:hub", async (req: Request, res: Response) => {
  try {
    const decisions = await listDecisions(graph, req.params.hub);
    res.json({ ok: true, decisions });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/api/health", async (_req: Request, res: Response) => {
  try {
    await graph.query("RETURN 1");
    res.json({ ok: true, falkordb: "connected" });
  } catch (err) {
    res.status(503).json({ ok: false, error: (err as Error).message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  API listening:  http://localhost:${PORT}`);
  console.log(`  SSE stream:     http://localhost:${PORT}/api/events`);
  console.log(`  Trigger:        POST http://localhost:${PORT}/api/trigger\n`);
});
