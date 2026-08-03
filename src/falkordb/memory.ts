/**
 * Memory-layer API over FalkorDB. Thin, typed wrappers around Query A + Query B
 * so the agent pipeline and RocketRide write-back call the graph the same way.
 */
import { connect, type Graph } from "./client.js";
import { QUERY_A, QUERY_B, QUERY_DECISIONS, PRODUCT } from "./schema.js";
import type { HubContext, ShipmentDecisionRecord } from "../types.js";

/** Query A — pull stock, demand, and modes for a hub as one HubContext row. */
export async function getHubContext(
  graph: Graph,
  hub: string,
  product = PRODUCT
): Promise<Omit<HubContext, "live_demand_multiplier">> {
  const res = await graph.query(QUERY_A, { params: { hub, product } });
  const row = (res.data as any[])?.[0];
  if (!row) throw new Error(`No graph data for hub "${hub}" / product "${product}"`);

  return {
    hub: row.hub,
    product,
    current_stock: Number(row.current_stock),
    avg_weekly_demand: Number(row.avg_weekly_demand),
    available_modes: (row.modes as any[]).map((m) => ({
      mode: m.mode,
      cost: Number(m.cost),
      transit_hrs: Number(m.transit_hrs),
    })),
  };
}

/** Query B — write the chosen decision back into the graph (memory compounds). */
export async function writeShipmentDecision(
  graph: Graph,
  record: ShipmentDecisionRecord
) {
  const res = await graph.query(QUERY_B, {
    params: {
      hub: record.hub,
      product: record.product,
      chosen_mode: record.mode,
      rationale: record.rationale,
    },
  });
  return (res.data as any[])?.[0];
}

/** List ShipmentDecisions written back for a hub, newest first (memory compounding). */
export async function listDecisions(
  graph: Graph,
  hub: string
): Promise<(ShipmentDecisionRecord & { timestamp: number })[]> {
  const res = await graph.query(QUERY_DECISIONS, { params: { hub } });
  return ((res.data as any[]) ?? []).map((row) => ({
    hub: row.hub,
    product: PRODUCT,
    mode: row.mode,
    cost: Number(row.cost),
    transit_hrs: Number(row.transit_hrs),
    rationale: row.rationale,
    timestamp: Number(row.timestamp),
  }));
}

/** Convenience: open a connection, run `fn`, always close. */
export async function withGraph<T>(fn: (graph: Graph) => Promise<T>): Promise<T> {
  const { db, graph } = await connect();
  try {
    return await fn(graph);
  } finally {
    await db.close();
  }
}
