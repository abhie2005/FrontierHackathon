/**
 * LaserData integration — the real-time signal layer.
 *
 * The flu-outbreak signal is PUBLISHED to a LaserData stream and CONSUMED back
 * out of it, so the trigger genuinely flows *through* LaserData (Apache Iggy)
 * rather than being a local label. Driven by LASER_CONNECTION_STRING
 * (bare `user:password@host:port`, e.g. from laserdata.cloud).
 *
 * SDK reference: Laser.connect / stream(name).topic(name) / .ensure(n) /
 * .json(codec).publish(obj) / .records(group).stream() (async iterable).
 */
import { Laser, jsonCodec } from "@laserdata/laser-sdk";
import type { TriggerEvent } from "../types.js";

const STREAM = process.env.LASER_STREAM ?? "hopper";
const TOPIC = "signals";

function connString(): string {
  return process.env.LASER_CONNECTION_STRING ?? "iggy:iggy@127.0.0.1:8090";
}

/** Runtime codec — validates decoded bytes into a TriggerEvent. */
const signalCodec = jsonCodec<TriggerEvent>((value) => {
  const o = value as Record<string, unknown>;
  if (!o || typeof o !== "object") throw new TypeError("signal must be an object");
  return {
    event: "flu_outbreak",
    hub: String(o.hub),
    product: String(o.product ?? "ColdRelief-500"),
    demand_multiplier: Number(o.demand_multiplier),
  };
});

async function connect() {
  return Laser.connect(connString());
}

/** Publish one outbreak signal into the LaserData stream. */
export async function publishSignal(event: TriggerEvent): Promise<void> {
  const laser = await connect();
  const base = laser.stream(STREAM).topic(TOPIC);
  await base.ensure(1);
  await base.json(signalCodec).publish(event);
  await (laser as { [Symbol.asyncDispose]?: () => Promise<void> })[Symbol.asyncDispose]?.();
}

/**
 * Long-running consumer: reads signals from LaserData as they arrive and calls
 * `handler` for each. Never returns (loops until the process is stopped).
 */
export async function consumeSignals(
  handler: (event: TriggerEvent) => Promise<void>,
  opts: { group?: string; waitMs?: number } = {}
): Promise<void> {
  const laser = await connect();
  const base = laser.stream(STREAM).topic(TOPIC);
  await base.ensure(1);
  const reader = await base.json(signalCodec).records(opts.group ?? "hopper-consumer");
  const pollIntervalMs = opts.waitMs ?? 1000;
  for await (const result of reader.stream({ pollIntervalMs })) {
    if (result.kind === "record") await handler(result.record.value);
    // result.kind === "error" → skip malformed records
  }
}
