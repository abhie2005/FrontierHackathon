/**
 * Person 1's live demo moment. Runs Query A (context pull) for Ohio, then
 * lists any ShipmentDecision nodes written back this session (Query B results).
 * Run:  npm run query
 */
import "../load-env.js";
import { connect } from "./client.js";
import { QUERY_A, QUERY_DECISIONS, PRODUCT } from "./schema.js";

const HUB = process.argv[2] ?? "Ohio";

async function main() {
  const { db, graph } = await connect();

  console.log(`\n=== Query A — context pull for ${HUB} / ${PRODUCT} ===`);
  const a = await graph.query(QUERY_A, { params: { hub: HUB, product: PRODUCT } });
  const ctx = (a.data as any[])?.[0];
  console.log(JSON.stringify(ctx, null, 2));

  console.log(`\n=== ShipmentDecisions written back for ${HUB} (memory) ===`);
  const d = await graph.query(QUERY_DECISIONS, { params: { hub: HUB } });
  const decisions = (d.data as any[]) ?? [];
  if (decisions.length === 0) {
    console.log("(none yet — run the pipeline to create one)");
  } else {
    for (const s of decisions) {
      console.log(
        `• ${s.mode.toUpperCase()} $${s.cost} / ${s.transit_hrs}hrs — ${s.rationale}`
      );
    }
  }

  await db.close();
}

main().catch((err) => {
  console.error("Query failed:", err);
  process.exit(1);
});
