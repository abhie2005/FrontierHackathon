/**
 * LaserData consumer process. Subscribes to the 'hopper/signals' stream and, for
 * every outbreak signal that arrives via LaserData, runs the full pipeline
 * (FalkorDB → Guild agents → RocketRide → write-back) and relays it to the UI.
 *
 * Run:  npm run laser:listen      (needs LASER_CONNECTION_STRING in .env)
 * Then fire a signal with:  npm run laser:fire
 */
import "../load-env.js";
import { consumeSignals } from "./laser.js";
import { runPipeline } from "../pipeline.js";
import { consoleEmitter, multi } from "../agents/events.js";
import { makeUiRelay } from "../ui-relay.js";

const uiUrl = process.env.UI_RELAY_URL ?? "http://localhost:4100";
const relay = makeUiRelay(uiUrl);

console.log("LaserData consumer listening on stream 'hopper/signals' — waiting for signals…\n");

consumeSignals(async (event) => {
  console.log(`\n← consumed signal from LaserData: ${JSON.stringify(event)}`);
  const emit = multi(consoleEmitter, relay.emit);
  await runPipeline(event, emit);
  await relay.flush();
}).catch((err) => {
  console.error("LaserData consumer failed:", err);
  process.exit(1);
});
