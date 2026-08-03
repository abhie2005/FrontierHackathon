/**
 * UI relay — translates our pipeline events into the exact shape Person 3's
 * server (server.js -> public/index.html) expects, and POSTs them to /event.
 * This is what makes the demo UI show REAL agent output instead of the
 * hardcoded placeholder text.
 *
 * Their contract (POST /event): { type, payload } where type is one of
 * trigger | risk_agent | mode_agent | rocketride | reset.
 */
import type { EmitFn, PipelineEvent } from "./agents/events.js";
import type { RiskAssessment, AgentDecision, TriggerEvent } from "./types.js";

export interface UiRelay {
  /** Emitter to pass into the pipeline. */
  emit: EmitFn;
  /** Await all in-flight POSTs — call before the process exits. */
  flush: () => Promise<void>;
}

/** Build an emitter that forwards translated events to the UI relay server. */
export function makeUiRelay(baseUrl: string): UiRelay {
  const url = `${baseUrl.replace(/\/$/, "")}/event`;
  const pending: Promise<unknown>[] = [];

  const post = (body: unknown) => {
    const p = fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {
      // UI not running is non-fatal — the pipeline still completes.
    });
    pending.push(p);
  };

  const emit: EmitFn = (e: Omit<PipelineEvent, "ts">) => {
    switch (e.source) {
      case "laserdata": {
        const t = e.detail as TriggerEvent | undefined;
        post({
          type: "trigger",
          payload: t ?? { event: "flu_outbreak", hub: "Ohio", product: "ColdRelief-500", demand_multiplier: 3.2 },
        });
        break;
      }
      case "risk-agent": {
        const r = e.detail as RiskAssessment | undefined;
        post({
          type: "risk_agent",
          payload: {
            message: e.label,
            risk_level: r?.risk_level,
            stockout_hours: r ? Math.round(r.days_of_stock_left * 24) : undefined,
            stockout_gap_days: r?.stockout_gap_days,
          },
        });
        break;
      }
      case "mode-agent": {
        const d = e.detail as AgentDecision | undefined;
        post({
          type: "mode_agent",
          payload: {
            message: d?.rationale ?? e.label,
            recommended_mode: d?.recommended_mode,
            cost: d?.cost,
            transit_hrs: d?.transit_hrs,
          },
        });
        break;
      }
      case "rocketride": {
        const d = e.detail as { executed?: boolean; mode?: string; transit_hrs?: number } | undefined;
        // Only relay the final EXECUTED event (it carries executed:true), not the
        // intermediate connection log lines.
        if (d?.executed) {
          post({
            type: "rocketride",
            payload: {
              message: e.label,
              confirmation_id: `RR-${Math.floor(Math.random() * 90000 + 10000)}`,
              recommended_mode: d.mode,
              eta_hours: d.transit_hrs,
            },
          });
        }
        break;
      }
      default:
        // guild / falkordb / system events aren't rendered by the UI panels.
        break;
    }
  };

  const flush = async () => {
    await Promise.allSettled(pending);
  };

  return { emit, flush };
}
