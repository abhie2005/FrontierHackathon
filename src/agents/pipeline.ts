/**
 * Person 2's standalone deliverable: mock input -> Risk Agent -> Mode Agent
 * -> RocketRide execute, with the FalkorDB write-back STUBBED as a print.
 * (The integrated version with a real graph write-back is src/pipeline.ts.)
 *
 * Run:  npm run agents
 */
import "../load-env.js";
import type { HubContext, ShipmentDecisionRecord } from "../types.js";
import { consoleEmitter } from "./events.js";
import { runGuildNegotiation } from "./guild.js";
import { execute_mode_selection } from "./rocketride.js";

// Hardcoded mock input — the exact FalkorDB -> Agents contract shape.
const MOCK_INPUT: HubContext = {
  hub: "Ohio",
  product: "ColdRelief-500",
  current_stock: 3800,
  avg_weekly_demand: 2800,
  live_demand_multiplier: 3.2,
  available_modes: [
    { mode: "rail", cost: 2000, transit_hrs: 120 },
    { mode: "truck", cost: 4500, transit_hrs: 48 },
    { mode: "air", cost: 9000, transit_hrs: 18 },
  ],
};

// Stubbed write-back (Person 1 wires the real one; here we just print).
const stubWriteBack = async (record: ShipmentDecisionRecord) => {
  console.log(
    `              [stub write-back] would CREATE ShipmentDecision → ${JSON.stringify(record)}`
  );
  return { stubbed: true, ...record };
};

async function main() {
  console.log("=== Adaptive Mode Selection — agent pipeline (mock input) ===\n");
  const { decision } = await runGuildNegotiation(MOCK_INPUT, consoleEmitter);
  console.log("");
  await execute_mode_selection(decision, stubWriteBack, consoleEmitter);
  console.log("\n=== Final decision ===");
  console.log(JSON.stringify(decision, null, 2));
}

main().catch((err) => {
  console.error("Pipeline failed:", err);
  process.exit(1);
});
