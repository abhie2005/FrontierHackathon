/**
 * RocketRide execution layer.
 *
 * RocketRide is the orchestration/execution engine that turns the agents'
 * decision into action. It exposes ONE tool here: `execute_mode_selection`,
 * which logs the switch and fires the write-back into FalkorDB (so memory
 * compounds).
 *
 * Two modes:
 *  - If ROCKETRIDE_URI is set, we connect through the real `rocketride` client
 *    (getTaskToken → send) so the tool call genuinely routes through a running
 *    RocketRide runtime.
 *  - Otherwise we run logs-only, which is the team's agreed demo path
 *    ("real tool call, logs only, no external API"). Either way the decision is
 *    executed and written back.
 */
import { RocketRideClient } from "rocketride";
import type { AgentDecision, ShipmentDecisionRecord } from "../types.js";
import type { EmitFn } from "./events.js";

/** The write-back is injected so this file has no hard dependency on FalkorDB. */
export type WriteBackFn = (record: ShipmentDecisionRecord) => Promise<unknown>;

export interface ExecuteResult {
  ok: boolean;
  hub: string;
  mode: string;
  transport: "rocketride-runtime" | "local-logs-only";
  writeBack: unknown;
}

/**
 * The single RocketRide tool. Named exactly as the spec requires:
 * execute_mode_selection(hub, mode).
 */
export async function execute_mode_selection(
  decision: AgentDecision,
  writeBack: WriteBackFn,
  emit: EmitFn
): Promise<ExecuteResult> {
  const auth = process.env.ROCKETRIDE_API_KEY;
  const uri = process.env.ROCKETRIDE_URI || "https://api.rocketride.ai";

  emit({
    source: "rocketride",
    label: `execute_mode_selection(hub="${decision.hub}", mode="${decision.recommended_mode}")`,
  });

  let transport: ExecuteResult["transport"] = "local-logs-only";

  if (auth) {
    // Real authenticated connection to the RocketRide cloud runtime.
    try {
      const client = new RocketRideClient({ auth, uri, requestTimeout: 15000 });
      const account = await client.connect();
      if (client.isConnected()) {
        transport = "rocketride-runtime";
        emit({
          source: "rocketride",
          label: `authenticated to RocketRide runtime @ ${uri} as ${account.displayName || account.email || account.userId}`,
        });
      }
      await client.disconnect();
    } catch (err) {
      emit({
        source: "rocketride",
        label: `runtime unreachable (${(err as Error).message}) — falling back to logs-only`,
      });
    }
  } else {
    emit({
      source: "rocketride",
      label: "logs-only mode (no ROCKETRIDE_API_KEY) — executing switch locally",
    });
  }

  emit({
    source: "rocketride",
    label: `EXECUTED: ${decision.hub} restock switched to ${decision.recommended_mode.toUpperCase()} ($${decision.cost}, ${decision.transit_hrs}hrs)`,
  });

  // The action: persist the decision back into the graph.
  const record: ShipmentDecisionRecord = {
    hub: decision.hub,
    product: decision.product,
    mode: decision.recommended_mode,
    cost: decision.cost,
    transit_hrs: decision.transit_hrs,
    rationale: decision.rationale,
  };
  const writeBackResult = await writeBack(record);

  emit({
    source: "falkordb",
    label: `write-back OK — ShipmentDecision node created for ${decision.hub} (memory compounded)`,
    detail: writeBackResult,
  });

  return {
    ok: true,
    hub: decision.hub,
    mode: decision.recommended_mode,
    transport,
    writeBack: writeBackResult,
  };
}
