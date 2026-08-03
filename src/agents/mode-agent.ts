/**
 * Mode Agent — given the hub context + the Risk Agent's assessment, picks the
 * transport mode. Defaults to cheapest (rail); on high risk, picks the cheapest
 * mode fast enough to close the stockout gap. Threshold logic, deterministic.
 */
import type { HubContext, RiskAssessment, AgentDecision } from "../types.js";

export function selectMode(
  ctx: HubContext,
  risk: RiskAssessment
): AgentDecision {
  const byCost = [...ctx.available_modes].sort((a, b) => a.cost - b.cost);
  const rail = byCost.find((m) => m.mode === "rail")!;

  // Low risk: keep the cheap default plan.
  if (risk.risk_level === "low") {
    return {
      hub: ctx.hub,
      product: ctx.product,
      risk_level: "low",
      stockout_gap_days: 0,
      recommended_mode: rail.mode,
      cost: rail.cost,
      transit_hrs: rail.transit_hrs,
      rationale: `Demand is within normal range; keeping the cheapest rail plan ($${rail.cost}).`,
    };
  }

  // High risk: how fast must we be? We need to arrive before stock runs out.
  // Available runway (days) = rail_transit_days - stockout_gap_days = days_of_stock_left.
  const runway_days = risk.days_of_stock_left;
  const runway_hrs = runway_days * 24;

  // Cheapest mode whose transit still fits inside the runway.
  const viable = byCost.filter((m) => m.transit_hrs <= runway_hrs);
  const chosen = viable[0] ?? byCost.find((m) => m.mode === "air")!; // fastest fallback

  const rationale =
    `Outbreak spikes demand ${round(risk.effective_weekly_demand)} units/wk — only ` +
    `~${runway_days} days of stock left, but rail takes ${risk.rail_transit_days} days ` +
    `(${risk.stockout_gap_days}-day stockout gap). Upgrading to ${chosen.mode} ` +
    `(${chosen.transit_hrs}hrs, $${chosen.cost}) arrives in time — cheapest option that closes the gap.`;

  return {
    hub: ctx.hub,
    product: ctx.product,
    risk_level: "high",
    stockout_gap_days: risk.stockout_gap_days,
    recommended_mode: chosen.mode,
    cost: chosen.cost,
    transit_hrs: chosen.transit_hrs,
    rationale,
  };
}

function round(n: number): number {
  return Math.round(n);
}
