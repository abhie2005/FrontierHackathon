/**
 * Seed data + Cypher for the adaptive mode selection network.
 * Graph shape:  Warehouse -[:SUPPLIES]-> Hub
 *               Product -[:STOCKED_AT {units}]-> Hub
 *               Product -[:HAS_DEMAND_HISTORY]-> DemandSignal
 *               Hub -[:HAS_MODE]-> TransportMode
 *               Hub -[:HAD_DECISION]-> ShipmentDecision   (written back at runtime)
 */

export interface HubSeed {
  name: string;
  stock: number;
  avg_weekly_units: number;
  modes: { mode: string; cost: number; transit_hrs: number }[];
}

export const WAREHOUSE = "LA Central";
export const PRODUCT = "ColdRelief-500";

export const HUBS: HubSeed[] = [
  {
    name: "Ohio",
    stock: 3800,
    avg_weekly_units: 2800,
    modes: [
      { mode: "rail", cost: 2000, transit_hrs: 120 },
      { mode: "truck", cost: 4500, transit_hrs: 48 },
      { mode: "air", cost: 9000, transit_hrs: 18 },
    ],
  },
  {
    name: "Texas",
    stock: 4200,
    avg_weekly_units: 3000,
    modes: [
      { mode: "rail", cost: 1800, transit_hrs: 96 },
      { mode: "truck", cost: 3800, transit_hrs: 36 },
      { mode: "air", cost: 8200, transit_hrs: 14 },
    ],
  },
  {
    name: "NewJersey",
    stock: 5000,
    avg_weekly_units: 3200,
    modes: [
      { mode: "rail", cost: 2200, transit_hrs: 132 },
      { mode: "truck", cost: 4800, transit_hrs: 54 },
      { mode: "air", cost: 9500, transit_hrs: 20 },
    ],
  },
];

/**
 * Build the full seed as parameterized Cypher statements.
 * Parameterized (not string-interpolated) so it stays injection-safe and clean.
 */
export function seedStatements(): { cypher: string; params: Record<string, string | number> }[] {
  const stmts: { cypher: string; params: Record<string, string | number> }[] = [];

  // Warehouse + product (created once).
  stmts.push({
    cypher: `MERGE (w:Warehouse {name: $warehouse})
             MERGE (p:Product {name: $product})`,
    params: { warehouse: WAREHOUSE, product: PRODUCT },
  });

  for (const hub of HUBS) {
    // Hub, SUPPLIES edge, stock edge, demand signal.
    stmts.push({
      cypher: `MATCH (w:Warehouse {name: $warehouse})
               MATCH (p:Product {name: $product})
               MERGE (h:Hub {name: $hub})
               MERGE (w)-[:SUPPLIES]->(h)
               MERGE (p)-[st:STOCKED_AT]->(h)
                 SET st.units = $stock
               MERGE (p)-[:HAS_DEMAND_HISTORY]->(d:DemandSignal {hub: $hub})
                 SET d.avg_weekly_units = $avg`,
      params: {
        warehouse: WAREHOUSE,
        product: PRODUCT,
        hub: hub.name,
        stock: hub.stock,
        avg: hub.avg_weekly_units,
      },
    });

    // Transport modes for this hub.
    for (const m of hub.modes) {
      stmts.push({
        cypher: `MATCH (h:Hub {name: $hub})
                 MERGE (h)-[:HAS_MODE]->(m:TransportMode {hub: $hub, mode: $mode})
                   SET m.cost = $cost, m.transit_hrs = $transit_hrs`,
        params: {
          hub: hub.name,
          mode: m.mode,
          cost: m.cost,
          transit_hrs: m.transit_hrs,
        },
      });
    }
  }

  return stmts;
}

/** Wipe the graph so seeding is idempotent across demo runs. */
export const RESET_CYPHER = `MATCH (n) DETACH DELETE n`;

/**
 * Query A — context pull. Given a hub + product, return stock, avg weekly
 * demand, and every transport mode collected into one row.
 */
export const QUERY_A = `
MATCH (p:Product {name: $product})-[st:STOCKED_AT]->(h:Hub {name: $hub})
MATCH (p)-[:HAS_DEMAND_HISTORY]->(d:DemandSignal {hub: $hub})
MATCH (h)-[:HAS_MODE]->(m:TransportMode)
RETURN h.name AS hub,
       st.units AS current_stock,
       d.avg_weekly_units AS avg_weekly_demand,
       collect({mode: m.mode, cost: m.cost, transit_hrs: m.transit_hrs}) AS modes
`;

/**
 * Query B — write-back. Creates a ShipmentDecision node linked to the hub via
 * HAD_DECISION so the graph's memory compounds over the session.
 */
export const QUERY_B = `
MATCH (h:Hub {name: $hub})-[:HAS_MODE]->(m:TransportMode {mode: $chosen_mode})
CREATE (s:ShipmentDecision {
  hub: $hub, product: $product, mode: $chosen_mode,
  cost: m.cost, transit_hrs: m.transit_hrs,
  rationale: $rationale, timestamp: timestamp()
})
CREATE (h)-[:HAD_DECISION]->(s)
RETURN s.hub AS hub, s.mode AS mode, s.cost AS cost,
       s.transit_hrs AS transit_hrs, s.rationale AS rationale, s.timestamp AS timestamp
`;

/** Demo-moment query: list decisions written back this session. */
export const QUERY_DECISIONS = `
MATCH (h:Hub {name: $hub})-[:HAD_DECISION]->(s:ShipmentDecision)
RETURN s.hub AS hub, s.mode AS mode, s.cost AS cost,
       s.transit_hrs AS transit_hrs, s.rationale AS rationale, s.timestamp AS timestamp
ORDER BY s.timestamp DESC
`;
