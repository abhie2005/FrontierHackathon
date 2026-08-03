# Project context — adaptive mode selection network

Master reference doc. Everything the team needs in one place.

---

## 1. The scenario

A central warehouse in Los Angeles receives international freight and distributes it to regional sub-warehouses ("hubs") across the country — Ohio, Texas, and New Jersey — each serving local demand for a product: cold/flu medicine (ColdRelief-500).

For any shipment leg, multiple transport modes are available (rail, truck, air), each with different cost and speed tradeoffs. Normally the system runs the cheapest option (rail).

**The trigger:** a live flu-outbreak signal spikes demand 3.2x at the Ohio hub.

**The core problem:** does the existing restock plan (cheap, slow rail) still hold up, or does the outbreak justify switching to a faster, more expensive mode to avoid a stockout of medicine people need urgently?

**The resolution:** two agents negotiate the cost-vs-urgency tradeoff, the system executes a mode switch, and the decision is written back into the graph so memory compounds.

---

## 2. Mandated tech stack and how each is used

| Tech | Role | How it's used here |
|---|---|---|
| **FalkorDB** | Memory layer | Graph of warehouse → hub → product → demand history → transport modes. Multi-hop queries feed both agents. Decisions write back into the graph. |
| **RocketRide** | Execution / orchestration | Executes the final mode-switch decision as a tool call; sequences the pipeline from graph read to agent decision to action. |
| **Guild.ai** | Multi-agent coordination | Risk Agent and Mode Agent negotiate a real cost-vs-speed tradeoff before RocketRide acts. |
| **LaserData** | Real-time data | Feeds the live flu-outbreak/demand-spike signal into the pipeline. |
| **Snyk** | Security (added technology) | Scans the project's actual code/dependencies for vulnerabilities as part of the build — real usage, run via CLI against the repo before demo. |

Judging note: every technology needs a visible, real moment on screen — a query executing, an agent handoff printing, a tool call firing, an event injecting, a scan output shown. No unused SDK imports.

---

## 3. Seed data

### Hubs and baseline stock
| Hub | Product | Current stock (units) | Avg weekly demand (units) |
|---|---|---|---|
| Texas | ColdRelief-500 | 4,200 | 3,000 |
| Ohio | ColdRelief-500 | 3,800 | 2,800 |
| New Jersey | ColdRelief-500 | 5,000 | 3,200 |

### Transport modes per lane (LA → Hub)
| Hub | Mode | Cost | Transit time |
|---|---|---|---|
| Ohio | Rail | $2,000 | 120 hrs |
| Ohio | Truck | $4,500 | 48 hrs |
| Ohio | Air | $9,000 | 18 hrs |
| Texas | Rail | $1,800 | 96 hrs |
| Texas | Truck | $3,800 | 36 hrs |
| Texas | Air | $8,200 | 14 hrs |
| New Jersey | Rail | $2,200 | 132 hrs |
| New Jersey | Truck | $4,800 | 54 hrs |
| New Jersey | Air | $9,500 | 20 hrs |

### The trigger event (demo instance)
- Hub: Ohio
- Signal: flu outbreak, demand multiplier = 3.2x
- New effective demand: 2,800 x 3.2 = 8,960 units/week
- Stockout gap: rail restock (5 days) arrives too late given the spiked burn rate (~2-day gap) — this is what the Risk Agent flags

### Cypher seed sketch
```cypher
CREATE (w:Warehouse {name: 'LA Central'})
CREATE (h1:Hub {name: 'Ohio'})
CREATE (h2:Hub {name: 'Texas'})
CREATE (h3:Hub {name: 'NewJersey'})
CREATE (w)-[:SUPPLIES]->(h1)
CREATE (w)-[:SUPPLIES]->(h2)
CREATE (w)-[:SUPPLIES]->(h3)

CREATE (p:Product {name: 'ColdRelief-500'})
CREATE (p)-[:STOCKED_AT {units: 3800}]->(h1)
CREATE (p)-[:STOCKED_AT {units: 4200}]->(h2)
CREATE (p)-[:STOCKED_AT {units: 5000}]->(h3)

CREATE (d1:DemandSignal {hub: 'Ohio', avg_weekly_units: 2800})
CREATE (p)-[:HAS_DEMAND_HISTORY]->(d1)

CREATE (m1:TransportMode {hub: 'Ohio', mode: 'rail', cost: 2000, transit_hrs: 120})
CREATE (m2:TransportMode {hub: 'Ohio', mode: 'truck', cost: 4500, transit_hrs: 48})
CREATE (m3:TransportMode {hub: 'Ohio', mode: 'air', cost: 9000, transit_hrs: 18})
CREATE (h1)-[:HAS_MODE]->(m1)
CREATE (h1)-[:HAS_MODE]->(m2)
CREATE (h1)-[:HAS_MODE]->(m3)
```
Repeat the `TransportMode` + `HAS_MODE` pattern for Texas and New Jersey using the table above.

### Query A — context pull (used by both agents)
```cypher
MATCH (p:Product {name: $product})-[:STOCKED_AT {}]->(h:Hub {name: $hub})
MATCH (p)-[:HAS_DEMAND_HISTORY]->(d:DemandSignal {hub: $hub})
MATCH (h)-[:HAS_MODE]->(m:TransportMode)
RETURN h.name AS hub, d.avg_weekly_units AS avg_demand,
       collect({mode: m.mode, cost: m.cost, transit_hrs: m.transit_hrs}) AS modes
```

### Query B — write-back
```cypher
MATCH (h:Hub {name: $hub})-[:HAS_MODE]->(m:TransportMode {mode: $chosen_mode})
CREATE (s:ShipmentDecision {
  hub: $hub, product: $product, mode: $chosen_mode,
  cost: m.cost, transit_hrs: m.transit_hrs,
  rationale: $rationale, timestamp: timestamp()
})
CREATE (h)-[:HAD_DECISION]->(s)
RETURN s
```

---

## 4. JSON contracts between components

**Falkor → Agents:**
```json
{
  "hub": "Ohio",
  "product": "ColdRelief-500",
  "current_stock": 3800,
  "avg_weekly_demand": 2800,
  "live_demand_multiplier": 3.2,
  "available_modes": [
    { "mode": "rail", "cost": 2000, "transit_hrs": 120 },
    { "mode": "truck", "cost": 4500, "transit_hrs": 48 },
    { "mode": "air", "cost": 9000, "transit_hrs": 18 }
  ]
}
```

**Agents → UI / RocketRide:**
```json
{
  "hub": "Ohio",
  "risk_level": "high",
  "stockout_gap_days": 2,
  "recommended_mode": "truck",
  "cost": 4500,
  "transit_hrs": 48,
  "rationale": "Rail arrives too late to cover the outbreak-driven demand spike; truck closes the 2-day gap at a moderate cost premium over rail."
}
```

**LaserData trigger event:**
```json
{
  "event": "flu_outbreak",
  "hub": "Ohio",
  "product": "ColdRelief-500",
  "demand_multiplier": 3.2
}
```

---

## 5. Agent decision logic

**Risk Agent:**
1. `effective_weekly_demand = avg_weekly_demand * live_demand_multiplier`
2. `days_of_stock_left = current_stock / (effective_weekly_demand / 7)`
3. If `days_of_stock_left < rail_transit_days`, flag `risk_level = "high"` and `stockout_gap_days = rail_transit_days - days_of_stock_left`
4. Output: `{ risk_level, stockout_gap_days }`

**Mode Agent:**
1. Default: cheapest mode (rail)
2. If risk is "high," pick the cheapest mode whose transit time still closes the gap
3. Output: `{ recommended_mode, cost, transit_hrs, rationale }`

Threshold-based, not free-form negotiation — reliable to demo, fast to build. Upgrade to LLM-generated rationale text only if time allows after 2:30.

---

## 6. Demo script (~60-75 sec)

1. **Baseline** — network view: LA + 3 hubs, current stock, all on rail. "Here's our baseline — cold medicine flowing from LA to three regional hubs via standard rail restock."
2. **Trigger** — fire the event, Ohio highlights red. "A flu outbreak signal just hit Ohio — demand there just tripled."
3. **Risk Agent** — log shows stockout gap. "Our Risk Agent is reading the graph — stock, demand history, the live spike — and calculating we'll run out before the next rail shipment arrives."
4. **Mode Agent** — log shows mode comparison, lands on truck. "The Mode Agent is weighing our transport options and recommending we upgrade to truck."
5. **Execution** — RocketRide fires, UI updates Ohio's route. "RocketRide executes the switch — and it's written back into FalkorDB, so this becomes part of the system's memory."
6. **Close** — live Cypher query showing the new ShipmentDecision node. "That's the full loop — live signal, graph-backed reasoning, multi-agent negotiation, real execution."

---

## 7. Timeline

| Time | Phase |
|---|---|
| 0:00-0:20 | Kickoff: lock story, freeze contracts, confirm real-vs-fake, assign ownership |
| 0:20-2:30 | Parallel build (see per-person breakdown in section 8) |
| 2:30-3:15 | Integration — wire all three pieces together, run Snyk scan |
| 3:15-3:45 | Rehearsal — run twice, record fallback video |
| 3:45-4:00 | Buffer — fix only, no new features |

Check-in at 1:15 (2 min, blockers only). No new features after 3:15.

---

## 8. Per-person ownership

**Person 1 — FalkorDB:** seed schema/data, write Query A + B, prep live-query demo moment.

**Person 2 — RocketRide + Guild.ai:** stub full pipeline early with mock data, build Risk Agent + Mode Agent threshold logic, wire RocketRide execute + write-back call, run Snyk against project dependencies.

**Person 3 — LaserData + demo UI:** attempt real LaserData feed (max 20 min) else mock trigger button, build 3-panel UI (network view, comparison table, live log), own demo narration.

---

## 9. Real vs. fake, decided up front

- FalkorDB: real, hand-seeded
- RocketRide: real tool call, logs only, no external API
- Guild.ai: real agent configs, threshold-based logic (not full LLM negotiation)
- LaserData: fake trigger via button unless a real feed is trivial to wire up
- Snyk: real — run against actual project dependencies before demo

---

## 10. Non-negotiables

- No new features after 3:15 — bug fixes only
- If something isn't working by 2:30, cut it and hardcode that segment
- Every one of the 5 technologies must have a visible, real moment on screen
