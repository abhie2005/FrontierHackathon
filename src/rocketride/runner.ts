/**
 * RocketRide execution path — runs the real `pipeline.pipe` on the RocketRide
 * runtime and returns the agents' decision.
 *
 * Inside the pipeline (see pipeline.pipe):
 *
 *   chat ──▶ Mode Agent ──▶ answers
 *              │
 *              ├── risk_agent (sub-agent, invoked as a tool)
 *              │      ├── falkordb_read   Query A — stock, demand, rail lead time
 *              │      └── python_math     the §5 threshold arithmetic, deterministically
 *              ├── falkordb_read          transport options for the lane
 *              └── falkordb_write         Query B — ShipmentDecision write-back
 *
 * So FalkorDB, the two-agent handoff and the execution/write-back all happen as
 * real RocketRide tool calls. `runPipeline` falls back to the local threshold
 * path (src/agents/*) if this is unconfigured or fails, so the demo never dies.
 */
import { RocketRideClient, Question } from "rocketride";
import type { AgentDecision, TriggerEvent } from "../types.js";
import type { EmitFn } from "../agents/events.js";
import {
  PIPE_PATH,
  loadPipelineConfig,
  rocketRideCredentials,
  rocketRideEnv,
} from "./pipeline-config.js";

export interface RocketRideRunResult {
  decision: AgentDecision;
  /** Raw answer text the pipeline returned, kept for the log panel. */
  raw: string;
  /** True when the Mode Agent reported a successful graph write-back. */
  writtenBack: boolean;
}

/** Pull the `answers` payload out of a PIPELINE_RESULT, honouring result_types. */
function extractAnswer(response: Record<string, unknown>): string {
  const resultTypes = (response.result_types ?? {}) as Record<string, string>;
  const keys = [
    ...Object.entries(resultTypes)
      .filter(([, lane]) => lane === "answers")
      .map(([key]) => key),
    "answers",
  ];

  for (const key of keys) {
    const value = response[key];
    if (Array.isArray(value) && value.length > 0) {
      const first = value[0];
      return typeof first === "string" ? first : JSON.stringify(first);
    }
    if (typeof value === "string" && value.trim()) return value;
  }
  throw new Error("Pipeline returned no answers");
}

/** Agents are told to answer with raw JSON; strip fences defensively anyway. */
function parseDecisionJson(answer: string): Record<string, unknown> {
  const fenced = answer.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : answer;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error(`Agent answer was not JSON: ${answer.slice(0, 200)}`);
  }
  return JSON.parse(body.slice(start, end + 1));
}

/** Coerce the agents' JSON into the frozen AgentDecision contract (src/types.ts). */
function toAgentDecision(parsed: Record<string, unknown>, trigger: TriggerEvent): AgentDecision {
  const mode = String(parsed.recommended_mode ?? "").toLowerCase();
  if (mode !== "rail" && mode !== "truck" && mode !== "air") {
    throw new Error(`Agent returned an unknown transport mode: "${parsed.recommended_mode}"`);
  }
  const risk = String(parsed.risk_level ?? "").toLowerCase() === "high" ? "high" : "low";

  return {
    hub: String(parsed.hub ?? trigger.hub),
    product: String(parsed.product ?? trigger.product),
    risk_level: risk,
    stockout_gap_days: Number(parsed.stockout_gap_days ?? 0),
    recommended_mode: mode,
    cost: Number(parsed.cost),
    transit_hrs: Number(parsed.transit_hrs),
    rationale: String(parsed.rationale ?? ""),
  };
}

/**
 * Start (or reuse) the pipeline on the RocketRide runtime and ask it to decide
 * the restock mode for one trigger event.
 */
export async function runViaRocketRide(
  trigger: TriggerEvent,
  emit: EmitFn
): Promise<RocketRideRunResult> {
  const { auth, uri } = rocketRideCredentials();
  if (!auth) throw new Error("ROCKETRIDE_APIKEY is not set");

  const env = rocketRideEnv();
  const pipeline = loadPipelineConfig();
  const client = new RocketRideClient({ auth, uri, env, module: "warehouse-memory-network" });

  try {
    const account = await client.connect();
    emit({
      source: "rocketride",
      label: `connected to RocketRide runtime @ ${uri} as ${account?.displayName || account?.email || "authenticated user"}`,
    });

    // Note: `client.validate()` is not usable against this runtime build — it
    // reports "'pipeline' is missing or invalid" for any flat config and silently
    // accepts anything wrapped, so it can't gate a demo. `use()` does the real
    // structural check and throws a specific error, which is what we surface.
    // `npm run check:rocketride` runs the same start-up as a pre-flight.
    const { token } = await client.use({
      pipeline,
      useExisting: true,
      name: `restock-decision:${trigger.hub}`,
    });
    emit({
      source: "rocketride",
      label: `pipeline running (token ${String(token).slice(0, 8)}…) — Mode Agent + Risk Agent + FalkorDB tools live`,
    });

    const question = new Question();
    question.addQuestion(
      `A live demand signal just fired for the ${trigger.hub} hub. Decide the transport mode for the next ColdRelief-500 restock from LA Central, and write the decision back into the graph.`
    );
    question.addContext(trigger as unknown as Record<string, unknown>);
    question.addGoal(
      "Return the final shipment decision as a single raw JSON object matching the agreed contract."
    );

    const response = await client.chat({
      token,
      question,
      onSSE: async (type, data) => {
        // Agents and tools broadcast progress here — surface it in the demo log.
        const label = typeof data?.message === "string" ? data.message : JSON.stringify(data);
        emit({ source: "rocketride", label: `${type}: ${label.slice(0, 160)}` });
      },
    });

    const raw = extractAnswer(response as unknown as Record<string, unknown>);
    const parsed = parseDecisionJson(raw);
    const decision = toAgentDecision(parsed, trigger);
    const writtenBack = parsed.written_back === true;

    emit({
      source: "mode-agent",
      label: `RECOMMEND ${decision.recommended_mode.toUpperCase()} — $${decision.cost} / ${decision.transit_hrs}hrs (risk ${decision.risk_level}, gap ${decision.stockout_gap_days}d)`,
      detail: decision,
    });

    return { decision, raw, writtenBack };
  } finally {
    await client.disconnect();
  }
}

export { PIPE_PATH };
