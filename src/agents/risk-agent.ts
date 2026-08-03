/**
 * Risk Agent — reads the hub context and decides whether the outbreak-driven
 * demand spike puts us at risk of a stockout before the default rail restock
 * arrives. Threshold logic (section 5 of PROJECT_CONTEXT.md), deterministic.
 */
import type { HubContext, RiskAssessment } from "../types.js";

export function assessRisk(ctx: HubContext): RiskAssessment {
  const effective_weekly_demand = ctx.avg_weekly_demand * ctx.live_demand_multiplier;

  // Days of stock left at the spiked burn rate.
  const daily_burn = effective_weekly_demand / 7;
  const days_of_stock_left = ctx.current_stock / daily_burn;

  // Rail is the default plan; compare against its transit time in days.
  const rail = ctx.available_modes.find((m) => m.mode === "rail");
  if (!rail) throw new Error(`No rail mode for hub ${ctx.hub}`);
  const rail_transit_days = rail.transit_hrs / 24;

  const at_risk = days_of_stock_left < rail_transit_days;
  const stockout_gap_days = at_risk
    ? round(rail_transit_days - days_of_stock_left)
    : 0;

  return {
    hub: ctx.hub,
    risk_level: at_risk ? "high" : "low",
    effective_weekly_demand: round(effective_weekly_demand),
    days_of_stock_left: round(days_of_stock_left),
    rail_transit_days: round(rail_transit_days),
    stockout_gap_days,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
