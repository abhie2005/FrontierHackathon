# Adaptive Mode Selection Network

An AI supply-chain system that **remembers** its network in a graph and **acts** on a live demand signal: when a flu outbreak spikes demand at a hub, two agents negotiate whether to switch from cheap/slow rail to a faster transport mode, and the decision is executed and written back into memory.

Built for the **Memory Meets Motion** hackathon. This repo is the **backend** (Person 1 — FalkorDB memory + Person 2 — Guild.ai agents + RocketRide execution). Person 3's UI consumes the pipeline's event stream.

## The loop

```
LaserData trigger  →  FalkorDB Query A (context)  →  Guild.ai negotiation
(Risk Agent → Mode Agent)  →  RocketRide execute  →  FalkorDB Query B (write-back)
```

Every one of the five mandated technologies has a real, visible moment:

| Tech | Real moment on screen |
|---|---|
| **FalkorDB** | `[falkordb] Query A …` context pull + `[falkordb] write-back OK` decision node created |
| **Guild.ai** | `[guild] → handoff to Risk Agent` … `→ hands "high" risk to Mode Agent` (visible negotiation) |
| **RocketRide** | `[rocketride] execute_mode_selection(hub, mode)` tool call firing |
| **LaserData** | `[laserdata] LIVE EVENT: flu_outbreak …` trigger injecting |
| **Snyk** | `snyk test` scan output before demo (see below) |

## Quick start

```bash
# 1. FalkorDB (local Docker; or set FALKORDB_* in .env for FalkorDB Cloud)
docker run -d --name falkordb -p 6379:6379 falkordb/falkordb:latest

# 2. install + seed the graph
npm install
npm run seed

# 3. run the full pipeline (LaserData trigger → agents → RocketRide → write-back)
npm run pipeline

# 4. live demo query — prove the decision persisted in the graph
npm run query
```

Other scripts:

- `npm run agents` — Person 2's standalone flow (mock input, stubbed write-back)
- `npm run typecheck` — strict TypeScript check

## Configuration (`.env`, copy from `.env.example`)

| Var | Purpose | Default |
|---|---|---|
| `FALKORDB_HOST` / `PORT` / `USERNAME` / `PASSWORD` | FalkorDB connection (local Docker **or** Cloud) | `localhost` / `6379` |
| `FALKORDB_GRAPH` | graph name | `warehouse` |
| `ROCKETRIDE_URI` | RocketRide runtime URI. If unset, RocketRide runs **logs-only** (agreed demo path) | *(unset)* |

## Sponsor accounts / credentials

| Tech | Needs an account? | Notes |
|---|---|---|
| **FalkorDB** | No, if using local Docker. Optional Cloud account for a hosted instance. | Local Docker works fully offline. |
| **Guild.ai** | **Yes** — the `@guildai/agents-sdk` package is not on public npm; it's gated behind a Guild.ai account. This repo implements Guild's coordination model faithfully so the real SDK can wrap each agent once the account SDK is available. | Sign up at guild.ai. |
| **RocketRide** | Optional — only if you want to route the tool call through a real runtime (`ROCKETRIDE_URI`). Logs-only mode needs nothing. | `rocketride` npm client is public; the runtime is separate. |
| **LaserData** | Person 3's area — free tier at laserdata.cloud, or a mock trigger button. | Trigger shape is frozen in `src/types.ts` (`TriggerEvent`). |
| **Snyk** | **Yes** — `snyk test` needs auth (`snyk auth` or `SNYK_TOKEN`). | `npm audit` (no account) currently reports **0 vulnerabilities**. |

## Snyk scan

```bash
# one-time: authenticate (opens browser) OR export SNYK_TOKEN=...
npx snyk auth

# scan the project dependencies
npx snyk test
```

`npm audit` reports 0 vulnerabilities today; `snyk test` gives the sponsor-visible scan output for the demo.

## Layout

```
src/
  types.ts                 # frozen JSON contracts (shared with Person 3's UI)
  falkordb/
    client.ts              # connection (local Docker or Cloud)
    schema.ts              # seed data + Query A + Query B (all 3 hubs)
    seed.ts                # npm run seed
    memory.ts              # getHubContext (A) + writeShipmentDecision (B)
    demo-query.ts          # npm run query — live stage moment
  agents/
    risk-agent.ts          # threshold: stockout-gap detection
    mode-agent.ts          # threshold: cheapest mode that closes the gap
    guild.ts               # visible two-agent negotiation + handoff
    rocketride.ts          # execute_mode_selection tool + write-back
    events.ts              # tagged event bus (drives console + UI)
    pipeline.ts            # npm run agents — standalone (mock input)
  pipeline.ts              # runPipeline() — full integrated flow (import for UI)
  run.ts                   # npm run pipeline — CLI entry
```
