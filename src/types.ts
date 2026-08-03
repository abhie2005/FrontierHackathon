/**
 * Frozen JSON contracts shared across the pipeline.
 * These mirror section 4 of PROJECT_CONTEXT.md exactly — do not change shapes
 * without telling Person 3 (UI consumes AgentDecision).
 */

/** A single transport option on a lane (LA -> Hub). */
export interface TransportMode {
  mode: "rail" | "truck" | "air";
  cost: number;
  transit_hrs: number;
}

/** FalkorDB (Query A) -> Agents. Also what the mock input looks like. */
export interface HubContext {
  hub: string;
  product: string;
  current_stock: number;
  avg_weekly_demand: number;
  live_demand_multiplier: number;
  available_modes: TransportMode[];
}

/** LaserData trigger event (Person 3 fires this). */
export interface TriggerEvent {
  event: "flu_outbreak";
  hub: string;
  product: string;
  demand_multiplier: number;
}

/** Risk Agent output. */
export interface RiskAssessment {
  hub: string;
  risk_level: "low" | "high";
  effective_weekly_demand: number;
  days_of_stock_left: number;
  rail_transit_days: number;
  stockout_gap_days: number;
}

/** Mode Agent output — the final decision the UI + RocketRide consume. */
export interface AgentDecision {
  hub: string;
  product: string;
  risk_level: "low" | "high";
  stockout_gap_days: number;
  recommended_mode: "rail" | "truck" | "air";
  cost: number;
  transit_hrs: number;
  rationale: string;
}

/** What RocketRide writes back into the graph (Query B input). */
export interface ShipmentDecisionRecord {
  hub: string;
  product: string;
  mode: string;
  cost: number;
  transit_hrs: number;
  rationale: string;
}
