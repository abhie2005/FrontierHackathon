# Hopper — Adaptive Distribution Network

A supply chain that **remembers and reacts**. When a live demand spike hits a hub, two autonomous
agents negotiate cost against urgency, a tool call reroutes the shipment, and the decision is
written back into graph memory — so it compounds over time instead of resetting every run.

Built for the **Memory Meets Motion** hackathon.

## The loop

```
LaserData signal  →  FalkorDB Query A (context)  →  Guild.ai negotiation
(Risk Agent → Mode Agent)  →  RocketRide execute  →  FalkorDB Query B (write-back)
```

Every integration has a real, visible moment — not a mocked log line:

| Tech | Role | Real moment |
|---|---|---|
| **FalkorDB** | Memory | `graph.query()` for context pull (Query A) and write-back (Query B) — decisions persist across runs |
| **Guild.ai** | Multi-agent coordination | Visible handoff: Risk Agent flags the stockout gap, hands it to the Mode Agent |
| **RocketRide** | Execution | `execute_mode_selection(hub, mode)` tool call — real authenticated runtime connection with a logs-only fallback |
| **LaserData** | Real-time signal | The outbreak signal is published to and consumed from a real LaserData (Apache Iggy) stream, not a local label |

## Architecture

```
┌─────────────┐   POST /api/trigger    ┌──────────────────┐
│  Dashboard  │ ─────────────────────► │                  │
│ (public/)   │ ◄───────────────────── │  Express server  │
└─────────────┘   SSE /api/events      │   src/server.ts  │
                                        │                  │
┌─────────────┐   publish/consume      │  runPipeline()   │
│  LaserData   │◄───────────────────── │   src/pipeline.ts│
└─────────────┘                        └─────────┬────────┘
                                                   │
                              ┌────────────────────┼────────────────────┐
                              ▼                    ▼                    ▼
                        FalkorDB graph      Guild.ai agents        RocketRide
                        (memory)         (Risk Agent → Mode Agent)  (execution)
```

The same `runPipeline()` can also be driven straight from LaserData without the dashboard
(`npm run laser:listen` + `npm run laser:fire`), or from the CLI (`npm run pipeline`).

## Quick start

```bash
# 1. FalkorDB (local Docker; or set FALKORDB_* in .env for FalkorDB Cloud)
docker run -d --name falkordb -p 6379:6379 -p 3000:3000 falkordb/falkordb:latest

# 2. install + seed the graph
npm install
cp .env.example .env   # fill in what you need — everything has a safe default/fallback
npm run seed

# 3. run the API + dashboard
npm run server
# → http://localhost:4000            live dashboard
# → http://localhost:4000/sponsors.html   "Powered By" page
```

Click **Fire Trigger** on the dashboard to run the real pipeline end to end and watch the live log.

## Scripts

| Script | What it does |
|---|---|
| `npm run server` / `npm start` | Express API + dashboard, one process (port `4000` by default — `3000` is taken by the FalkorDB Browser UI) |
| `npm run seed` | Seed/reset the graph with the hub + transport-mode data |
| `npm run pipeline` | Run the full pipeline once from the CLI (`npm run pipeline -- Ohio 3.2`) |
| `npm run query` | Live demo query — proves a decision persisted in the graph |
| `npm run laser:listen` | Consumer process — subscribes to the LaserData stream and runs the pipeline on every signal |
| `npm run laser:fire` | Publishes one outbreak signal into LaserData (`npm run laser:fire -- Ohio 3.2`) |
| `npm run agents` | Standalone agents flow with mocked input (no FalkorDB/RocketRide needed) |
| `npm run typecheck` | Strict TypeScript check, no emit |

## Configuration

Copy `.env.example` to `.env`. Every value has a safe local default — nothing is required to run
against local Docker.

| Var | Purpose | Default |
|---|---|---|
| `FALKORDB_HOST` / `FALKORDB_PORT` / `FALKORDB_USERNAME` / `FALKORDB_PASSWORD` | FalkorDB connection (local Docker **or** Cloud) | `localhost` / `6379` |
| `FALKORDB_GRAPH` | Graph name | `warehouse` |
| `ROCKETRIDE_API_KEY` / `ROCKETRIDE_URI` | Real RocketRide runtime auth. Empty key → logs-only execution | *(unset → logs-only)* |
| `LASER_CONNECTION_STRING` / `LASER_STREAM` | LaserData (Apache Iggy) connection — free at [laserdata.cloud](https://laserdata.cloud) | *(unset)* |
| `PORT` | Express server port | `4000` |
| `ANTHROPIC_API_KEY` / `LLM_RATIONALE` | Optional LLM-generated rationale text. Threshold logic works fully without it | *(unset → off)* |

## Deploy

See [`DEPLOY.md`](./DEPLOY.md) for standing this up on Railway (Docker build included —
`Dockerfile` + `railway.json` at the repo root).

## Project layout

```
public/
  index.html               dashboard — map, pipeline strip, live log, mode comparison
  sponsors.html            "Powered By" page

src/
  server.ts                Express API: /api/trigger, /api/events (SSE), /api/decisions/:hub
  pipeline.ts               runPipeline() — the full integrated flow, called by the server & CLI
  run.ts                    CLI entry (npm run pipeline)
  types.ts                  frozen JSON contracts shared across the whole pipeline

  falkordb/
    client.ts                connection (local Docker or Cloud)
    schema.ts                seed data + Query A + Query B (all 3 hubs)
    memory.ts                getHubContext (A) / writeShipmentDecision (B) / listDecisions
    seed.ts, seed-per-hub.ts npm run seed[:hubs]
    demo-query.ts             npm run query — live stage moment

  agents/
    risk-agent.ts             threshold: stockout-gap detection
    mode-agent.ts             threshold: cheapest mode that closes the gap
    guild.ts                  visible two-agent negotiation + handoff
    rocketride.ts              execute_mode_selection tool + write-back
    events.ts                  tagged event bus (drives console + SSE)

  laserdata/
    laser.ts                  publish/consume against a real LaserData stream
    fire.ts, listen.ts         npm run laser:fire / laser:listen

guild/
  risk-agent/, mode-agent/   standalone @guildai/agents-sdk packages (deployable to a real Guild.ai account)

Dockerfile, railway.json, DEPLOY.md   deploy config
```
