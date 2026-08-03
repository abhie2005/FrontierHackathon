/**
 * Seeds the warehouse graph into FalkorDB. Idempotent: wipes and re-creates.
 * Run:  npm run seed
 */
import "../load-env.js";
import { connect } from "./client.js";
import { RESET_CYPHER, seedStatements, HUBS } from "./schema.js";

async function main() {
  const { db, graph, graphName } = await connect();
  console.log(`Connected to FalkorDB — graph "${graphName}"`);

  console.log("Wiping existing graph…");
  await graph.query(RESET_CYPHER);

  const stmts = seedStatements();
  console.log(`Seeding ${stmts.length} statements across ${HUBS.length} hubs…`);
  for (const { cypher, params } of stmts) {
    await graph.query(cypher, { params });
  }

  // Quick sanity counts.
  const counts = await graph.query(
    `MATCH (h:Hub) WITH count(h) AS hubs
     MATCH (m:TransportMode) WITH hubs, count(m) AS modes
     RETURN hubs, modes`
  );
  const row = (counts.data as any[])?.[0];
  console.log(`Seed complete — ${row?.hubs} hubs, ${row?.modes} transport modes.`);

  await db.close();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
