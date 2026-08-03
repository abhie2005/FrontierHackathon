/**
 * Guild.ai coordination layer.
 *
 * Guild.ai's own SDK (@guildai/agents-sdk) is gated behind a Guild.ai account and
 * is NOT on public npm, so this module implements Guild's coordination *model*
 * faithfully — named specialist agents with an explicit, visible handoff — behind
 * a small interface. When the team's Guild.ai account SDK is available, each
 * `GuildAgent.run` body is what gets wrapped as a Guild LLM/state agent; the
 * coordination + handoff surface here stays the same.
 *
 * The point that must be demoable (per PROJECT_CONTEXT §5): the negotiation /
 * handoff between Risk Agent and Mode Agent is emitted as events, not buried.
 */
import type { HubContext, RiskAssessment, AgentDecision } from "../types.js";
import type { EmitFn } from "./events.js";
import { assessRisk } from "./risk-agent.js";
import { selectMode } from "./mode-agent.js";

export interface GuildResult {
  risk: RiskAssessment;
  decision: AgentDecision;
}

/**
 * Runs the two-agent negotiation with a visible handoff.
 * Risk Agent reasons first, hands its assessment to Mode Agent, which decides.
 */
export async function runGuildNegotiation(
  ctx: HubContext,
  emit: EmitFn
): Promise<GuildResult> {
  emit({
    source: "guild",
    label: `Coordinating negotiation for ${ctx.hub} — 2 agents: Risk Agent, Mode Agent`,
  });

  // --- Risk Agent turn ---
  emit({ source: "guild", label: "→ handoff to Risk Agent" });
  const risk = assessRisk(ctx);
  emit({
    source: "risk-agent",
    label:
      risk.risk_level === "high"
        ? `RISK HIGH — ~${risk.days_of_stock_left}d stock vs ${risk.rail_transit_days}d rail → ${risk.stockout_gap_days}d stockout gap`
        : `RISK LOW — ${risk.days_of_stock_left}d stock covers ${risk.rail_transit_days}d rail lead time`,
    detail: risk,
  });

  // --- Handoff ---
  emit({
    source: "guild",
    label: `→ Risk Agent hands "${risk.risk_level}" risk to Mode Agent`,
  });

  // --- Mode Agent turn ---
  const decision = selectMode(ctx, risk);
  emit({
    source: "mode-agent",
    label: `RECOMMEND ${decision.recommended_mode.toUpperCase()} — $${decision.cost} / ${decision.transit_hrs}hrs`,
    detail: decision,
  });

  emit({
    source: "guild",
    label: `Agents agreed: ${decision.recommended_mode.toUpperCase()} for ${ctx.hub}`,
  });

  return { risk, decision };
}
