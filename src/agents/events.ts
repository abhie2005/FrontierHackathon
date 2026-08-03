/**
 * Pipeline event bus. Every meaningful step emits a tagged event so the same
 * stream drives both the console log and Person 3's live UI panel. The `source`
 * tag is what makes each technology's "real moment" visible on screen.
 */
export type EventSource =
  | "laserdata"
  | "falkordb"
  | "guild"
  | "risk-agent"
  | "mode-agent"
  | "rocketride"
  | "system";

export interface PipelineEvent {
  source: EventSource;
  label: string; // short human line for the log panel
  detail?: unknown; // structured payload (agent output, query result, etc.)
  ts: number;
}

export type EmitFn = (e: Omit<PipelineEvent, "ts">) => void;

/** Console emitter with a source badge, used when running from the CLI. */
export const consoleEmitter: EmitFn = (e) => {
  const badge = `[${e.source}]`.padEnd(13);
  console.log(`${badge} ${e.label}`);
  if (e.detail !== undefined) {
    console.log(
      "              " +
        JSON.stringify(e.detail).replace(/,/g, ", ").slice(0, 400)
    );
  }
};

/** Fan out to several emitters (e.g. console + a UI websocket sink). */
export function multi(...emitters: EmitFn[]): EmitFn {
  return (e) => emitters.forEach((fn) => fn(e));
}
