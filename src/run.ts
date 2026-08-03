/**
 * CLI entry for the full integrated pipeline.
 * Run:  npm run pipeline                 (defaults to Ohio flu outbreak x3.2)
 *       npm run pipeline -- Ohio 3.2      (explicit hub + multiplier)
 */
import "./load-env.js";
import { runPipeline } from "./pipeline.js";
import type { TriggerEvent } from "./types.js";

const trigger: TriggerEvent = {
  event: "flu_outbreak",
  hub: process.argv[2] ?? "Ohio",
  product: "ColdRelief-500",
  demand_multiplier: Number(process.argv[3] ?? 3.2),
};

console.log("=== Adaptive Mode Selection — FULL pipeline (live graph) ===\n");
runPipeline(trigger)
  .then(({ decision }) => {
    console.log("\n=== Final decision ===");
    console.log(JSON.stringify(decision, null, 2));
  })
  .catch((err) => {
    console.error("Pipeline failed:", err);
    process.exit(1);
  });
