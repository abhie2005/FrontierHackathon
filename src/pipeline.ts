/**
 * FULL INTEGRATED PIPELINE — the demo backend end to end:
 *
 *   LaserData trigger  ->  FalkorDB Query A (context)  ->  Guild.ai negotiation
 *   (Risk Agent -> Mode Agent)  ->  RocketRide execute  ->  FalkorDB Query B write-back
 *
 * The negotiation + execution runs one of two ways:
 *
 *   1. **RocketRide pipeline** (`pipeline.pipe`) when ROCKETRIDE_APIKEY and an
 *      Anthropic key are configured. Both agents, the FalkorDB reads and the
 *      write-back all execute as real RocketRide tool calls on the runtime.
 *   2. **Local threshold path** (src/agents/*) otherwise, or if the runtime call
 *      fails. Same event stream, same decision contract — the demo never dies.
 *
 * This is what Person 3's UI drives. Requires a seeded FalkorDB (npm run seed).
 * Run:  npm run pipeline            (defaults to the Ohio flu-outbreak trigger)
 */
import { connect } from "./falkordb/client.js";
import { getHubContext, writeShipmentDecision } from "./falkordb/memory.js";
import { runGuildNegotiation } from "./agents/guild.js";
import { execute_mode_selection, type ExecuteResult } from "./agents/rocketride.js";
import { consoleEmitter, type EmitFn } from "./agents/events.js";
import { isRocketRideConfigured } from "./rocketride/pipeline-config.js";
import { runViaRocketRide } from "./rocketride/runner.js";
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

    // Query A — pull graph context, fold in the live multiplier. The RocketRide
    // agents re-read this themselves via tool_falkordb; we read it here too so
    // the UI's network panel always has the numbers, on either path.
    const base = await getHubContext(graph, trigger.hub, trigger.product);
    const ctx: HubContext = { ...base, live_demand_multiplier: trigger.demand_multiplier };
    emit({
      source: "falkordb",
      label: `Query A — ${ctx.hub}: ${ctx.current_stock} units, ${ctx.avg_weekly_demand}/wk baseline, ${ctx.available_modes.length} modes`,
      detail: ctx,
    });

    // --- Path 1: the real RocketRide pipeline ---
    if (isRocketRideConfigured()) {
      try {
        emit({
          source: "guild",
          label: `Handing ${ctx.hub} to the RocketRide pipeline — Mode Agent delegates to Risk Agent`,
        });

        const { decision, writtenBack } = await runViaRocketRide(trigger, emit);

        // The Mode Agent owns the write-back (Query B) via its falkordb_write
        // tool. If it reported failure, persist here so memory still compounds.
        let writeBack: unknown = { by: "rocketride-pipeline" };
        if (writtenBack) {
          emit({
            source: "falkordb",
            label: `write-back OK — ShipmentDecision node created for ${decision.hub} by the pipeline's falkordb_write tool (memory compounded)`,
          });
        } else {
          writeBack = await writeShipmentDecision(graph, {
            hub: decision.hub,
            product: decision.product,
            mode: decision.recommended_mode,
            cost: decision.cost,
            transit_hrs: decision.transit_hrs,
            rationale: decision.rationale,
          });
          emit({
            source: "falkordb",
            label: `write-back OK — ShipmentDecision node created for ${decision.hub} (agent write-back unconfirmed, persisted locally)`,
            detail: writeBack,
          });
        }

        const result: ExecuteResult = {
          ok: true,
          hub: decision.hub,
          mode: decision.recommended_mode,
          transport: "rocketride-pipeline",
          writeBack,
        };
        emit({ source: "system", label: "Pipeline complete." });
        return { decision, result };
      } catch (err) {
        emit({
          source: "rocketride",
          label: `pipeline run failed (${(err as Error).message}) — falling back to local threshold agents`,
        });
      }
    }

    // --- Path 2: local threshold agents (fallback and no-credentials default) ---
    const { decision } = await runGuildNegotiation(ctx, emit);

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
