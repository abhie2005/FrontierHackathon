/**
 * Publishes one outbreak signal into LaserData (the "live event" injection).
 * The running consumer (npm run laser:listen) picks it up and drives the pipeline.
 *
 * Run:  npm run laser:fire            (defaults to Ohio ×3.2)
 *       npm run laser:fire -- Ohio 3.2
 */
import "../load-env.js";
import { publishSignal } from "./laser.js";
import type { TriggerEvent } from "../types.js";

const trigger: TriggerEvent = {
  event: "flu_outbreak",
  hub: process.argv[2] ?? "Ohio",
  product: "ColdRelief-500",
  demand_multiplier: Number(process.argv[3] ?? 3.2),
};

console.log(`→ publishing signal to LaserData: ${JSON.stringify(trigger)}`);
publishSignal(trigger)
  .then(() => { console.log("published ✓ — consumer will pick it up"); process.exit(0); })
  .catch((err) => { console.error("publish failed:", err); process.exit(1); });
