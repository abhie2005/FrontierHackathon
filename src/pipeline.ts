/**
 * FULL INTEGRATED PIPELINE — the demo backend end to end:
 *
 *   LaserData trigger  ->  FalkorDB Query A (context)  ->  Guild.ai negotiation
 *   (Risk Agent -> Mode Agent)  ->  RocketRide execute  ->  FalkorDB Query B write-back
 *
 * This is what Person 3's UI drives. Requires a seeded FalkorDB (npm run seed).
 * Run:  npm run pipeline            (defaults to the Ohio flu-outbreak trigger)
 */
import { connect } from "./falkordb/client.js";
import { getHubContext, writeShipmentDecision } from "./falkordb/memory.js";
import { runGuildNegotiation } from "./agents/guild.js";
import { execute_mode_selection } from "./agents/rocketride.js";
import { consoleEmitter, type EmitFn } from "./agents/events.js";
import type { TriggerEvent, HubContext } from "./types.js";

/** Runs the full pipeline for one trigger event. Exported so a server/UI can call it. */
export async function runPipeline(trigger: TriggerEvent, emit: EmitFn = consoleEmitter) {
  const { db, graph } = await connect();
  try {
    emit({
      source: "laserdata",
      label: `LIVE EVENT: ${trigger.event} @ ${trigger.hub} — demand x${trigger.demand_multiplier}`,
      detail: trigger,
    });

    // Query A — pull graph context, fold in the live multiplier.
    const base = await getHubContext(graph, trigger.hub, trigger.product);
    const ctx: HubContext = { ...base, live_demand_multiplier: trigger.demand_multiplier };
    emit({
      source: "falkordb",
      label: `Query A — ${ctx.hub}: ${ctx.current_stock} units, ${ctx.avg_weekly_demand}/wk baseline, ${ctx.available_modes.length} modes`,
      detail: ctx,
    });

    // Guild.ai — two-agent negotiation with visible handoff.
    const { decision } = await runGuildNegotiation(ctx, emit);

    // RocketRide — execute the switch + write-back (Query B).
    const result = await execute_mode_selection(
      decision,
      (record) => writeShipmentDecision(graph, record),
      emit
    );

    emit({ source: "system", label: "Pipeline complete." });
    return { decision, result };
  } finally {
    await db.close();
  }
}
