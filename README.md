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
| **RocketRide** | Execution / orchestration | `pipeline.pipe` runs on the RocketRide runtime: the Mode Agent delegates to the Risk Agent, both call FalkorDB and Python tools, and the write-back is a real tool call. Falls back to local threshold agents if unconfigured |
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

## The RocketRide pipeline (`pipeline.pipe`)

The negotiation and execution run as a real RocketRide pipeline whenever
`ROCKETRIDE_API_KEY` and `ANTHROPIC_API_KEY` are set:

```
chat ──▶ Mode Agent ──▶ answers ──▶ response_answers
            │
            ├── risk_agent          sub-agent, invoked as a tool (the handoff)
            │      ├── falkordb_read    Query A — stock, demand, rail lead time
            │      ├── python_math      the threshold arithmetic, deterministically
            │      └── memory_risk
            ├── falkordb_read       transport options for the lane
            ├── falkordb_write      Query B — ShipmentDecision write-back
            └── memory_mode
                       (both agents share llm_anthropic_1)
```

Two `agent_rocketride` nodes, wired hierarchically: the Mode Agent owns the decision and
invokes the Risk Agent as a tool, so the handoff is a real agent-to-agent call rather than a
narrated one. The Risk Agent is forbidden from doing arithmetic in its head — it runs the
`days_of_stock_left` / `stockout_gap_days` formulas through `tool_python`, which keeps the
numbers identical to the local threshold path. The Mode Agent's selection rule (cheapest mode
whose transit closes the gap) is fixed in its instructions, not left to the model.

```bash
npm run check:rocketride   # parses the .pipe, resolves ${ROCKETRIDE_*}, checks FalkorDB,
                           # then actually starts the pipeline on the runtime and stops it
```

Two things to know:

- **The runtime has to reach FalkorDB.** `falkordb_read` / `falkordb_write` connect from
  RocketRide's side, so `localhost` only works with a self-hosted engine. For the hosted
  runtime at `api.rocketride.ai`, point `FALKORDB_*` at FalkorDB Cloud.
- **`client.validate()` is not trustworthy on this runtime build** — it rejects every flat
  config with `'pipeline' is missing or invalid` and silently accepts anything wrapped. The
  pre-flight starts the pipeline for real instead, which is the only check that means anything.

Set `ROCKETRIDE_PIPELINE=0` to force the local threshold agents.

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
| `npm run check:rocketride` | Pre-flight for `pipeline.pipe` — file shape, env substitution, FalkorDB, then a real runtime start |
| `npm run agents` | Standalone agents flow with mocked input (no FalkorDB/RocketRide needed) |
| `npm run typecheck` | Strict TypeScript check, no emit |

## Configuration

Copy `.env.example` to `.env`. Every value has a safe local default — nothing is required to run
against local Docker.

| Var | Purpose | Default |
|---|---|---|
| `FALKORDB_HOST` / `FALKORDB_PORT` / `FALKORDB_USERNAME` / `FALKORDB_PASSWORD` | FalkorDB connection (local Docker **or** Cloud) | `localhost` / `6379` |
| `FALKORDB_GRAPH` | Graph name | `warehouse` |
| `ROCKETRIDE_API_KEY` / `ROCKETRIDE_URI` | RocketRide runtime auth. With `ANTHROPIC_API_KEY`, `pipeline.pipe` runs on the runtime; otherwise the local threshold agents do | *(unset → local agents)* |
| `ROCKETRIDE_PIPELINE` | Set to `0` to force the local threshold agents even with credentials present | `1` |
| `LASER_CONNECTION_STRING` / `LASER_STREAM` | LaserData (Apache Iggy) connection — free at [laserdata.cloud](https://laserdata.cloud) | *(unset)* |
| `PORT` | Express server port | `4000` |
| `ANTHROPIC_API_KEY` | Powers `llm_anthropic_1` inside `pipeline.pipe` (and the optional `LLM_RATIONALE=1` path). Required for the RocketRide pipeline; the local path works fully without it | *(unset → local agents)* |

## Deploy

See [`DEPLOY.md`](./DEPLOY.md) for standing this up on Railway (Docker build included —
`Dockerfile` + `railway.json` at the repo root).

## Project layout

```
pipeline.pipe              the RocketRide pipeline: 2 agents, FalkorDB read/write, python tool

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
    rocketride.ts              execute_mode_selection tool + write-back (local path)
    events.ts                  tagged event bus (drives console + SSE)

  rocketride/
    pipeline-config.ts        loads pipeline.pipe, mirrors env, patches typed fields
    runner.ts                 runs pipeline.pipe on the runtime, parses the decision
    check.ts                  npm run check:rocketride

  laserdata/
    laser.ts                  publish/consume against a real LaserData stream
    fire.ts, listen.ts         npm run laser:fire / laser:listen

guild/
  risk-agent/, mode-agent/   standalone @guildai/agents-sdk packages (deployable to a real Guild.ai account)

Dockerfile, railway.json, DEPLOY.md   deploy config
```
