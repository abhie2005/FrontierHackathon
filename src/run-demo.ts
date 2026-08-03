/**
 * Demo entry: runs the full pipeline AND streams real events into Person 3's UI.
 * Start the UI first (node server.js), then:  npm run demo
 *
 * Env: UI_RELAY_URL (default http://localhost:3000)
 */
import "./load-env.js";
import { runPipeline } from "./pipeline.js";
import { consoleEmitter, multi } from "./agents/events.js";
import { makeUiRelay } from "./ui-relay.js";
import type { TriggerEvent } from "./types.js";

const uiUrl = process.env.UI_RELAY_URL ?? "http://localhost:3000";

const trigger: TriggerEvent = {
  event: "flu_outbreak",
  hub: process.argv[2] ?? "Ohio",
  product: "ColdRelief-500",
  demand_multiplier: Number(process.argv[3] ?? 3.2),
};

const relay = makeUiRelay(uiUrl);
const emit = multi(consoleEmitter, relay.emit);

console.log(`=== Demo pipeline — relaying real events to ${uiUrl}/event ===\n`);
runPipeline(trigger, emit)
  .then(async ({ decision }) => {
    await relay.flush(); // ensure all POSTs land before the process exits
    console.log(`\nDone — UI shows: ${decision.recommended_mode.toUpperCase()} for ${decision.hub}`);
  })
  .catch(async (err) => {
    await relay.flush();
    console.error("Demo pipeline failed:", err);
    process.exit(1);
  });
