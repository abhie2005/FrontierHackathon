/**
 * Pre-flight check for the RocketRide pipeline.
 *
 * Verifies, in order:
 *   1. `pipeline.pipe` parses and has the shape the engine expects
 *   2. every `${ROCKETRIDE_*}` placeholder in it resolves from the environment
 *   3. FalkorDB is reachable and seeded
 *   4. the RocketRide runtime actually starts the pipeline (`use()` then
 *      `terminate()`, so the next real run picks up any edits to the file)
 *
 * Step 4 deliberately does NOT use `client.validate()`: this runtime build
 * rejects every flat config with "'pipeline' is missing or invalid" and silently
 * accepts anything wrapped, so it can't tell a good pipeline from a broken one.
 * Starting the pipeline for real is the only trustworthy check.
 *
 * Run:  npm run check:rocketride
 */
import "../load-env.js";
import { RocketRideClient } from "rocketride";
import { connect } from "../falkordb/client.js";
import {
  PIPE_PATH,
  loadPipelineConfig,
  rocketRideCredentials,
  rocketRideEnv,
} from "./pipeline-config.js";

const ok = (msg: string) => console.log(`  PASS  ${msg}`);
const warn = (msg: string) => console.log(`  WARN  ${msg}`);
const fail = (msg: string) => console.log(`  FAIL  ${msg}`);

let failures = 0;
let warnings = 0;

async function main() {
  console.log(`\nRocketRide pre-flight — ${PIPE_PATH}\n`);

  // 1. Pipeline file structure.
  const pipeline = loadPipelineConfig();
  const components = pipeline.components ?? [];
  const ids = components.map((c) => c.id);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);

  if (!components.length) {
    fail("pipeline.pipe has no components");
    failures++;
  } else if (duplicates.length) {
    fail(`duplicate component ids: ${duplicates.join(", ")}`);
    failures++;
  } else {
    ok(`pipeline.pipe parsed — ${components.length} components: ${ids.join(", ")}`);
  }

  if (!/^[0-9a-f-]{36}$/i.test(String(pipeline.project_id ?? ""))) {
    fail(`project_id must be a literal GUID, got "${pipeline.project_id}"`);
    failures++;
  } else {
    ok(`project_id ${pipeline.project_id}`);
  }

  // agent_rocketride needs exactly one llm + one memory wired via `control`.
  for (const agent of components.filter((c) => c.provider === "agent_rocketride")) {
    const controllers = (classType: string) =>
      components.filter((c) =>
        ((c as { control?: { classType: string; from: string }[] }).control ?? []).some(
          (ctl) => ctl.classType === classType && ctl.from === agent.id
        )
      );
    const llms = controllers("llm");
    const memories = controllers("memory");
    const tools = controllers("tool");

    if (llms.length !== 1 || memories.length !== 1) {
      fail(
        `${agent.id}: agent_rocketride needs exactly 1 llm and 1 memory via control, found ${llms.length} llm / ${memories.length} memory`
      );
      failures++;
    } else {
      ok(
        `${agent.id}: llm=${llms[0].id}, memory=${memories[0].id}, tools=[${tools.map((t) => t.id).join(", ") || "none"}]`
      );
    }
  }

  // 2. Environment substitution.
  const env = rocketRideEnv();
  const placeholders = new Set(
    Array.from(JSON.stringify(pipeline).matchAll(/\$\{(ROCKETRIDE_[A-Z0-9_]+)\}/g)).map(
      (m) => m[1]
    )
  );
  for (const name of placeholders) {
    const value = env[name] ?? process.env[name];
    if (value) {
      const shown = /KEY|PASSWORD|TOKEN/.test(name) ? `${value.slice(0, 6)}…` : value;
      ok(`${name} = ${shown}`);
    } else if (/USERNAME|PASSWORD/.test(name)) {
      warn(`${name} is empty (fine for a local FalkorDB with no auth)`);
      warnings++;
    } else {
      fail(`${name} is not set — add it to .env`);
      failures++;
    }
  }

  // 3. FalkorDB reachability + seed data.
  try {
    const { db, graph } = await connect();
    try {
      const res = await graph.query("MATCH (h:Hub)-[:HAS_MODE]->(m:TransportMode) RETURN count(m) AS modes");
      const modes = Number((res.data as { modes: number }[])?.[0]?.modes ?? 0);
      if (modes === 0) {
        fail("FalkorDB reachable but empty — run `npm run seed`");
        failures++;
      } else {
        ok(`FalkorDB reachable — ${modes} TransportMode edges in graph "${env.ROCKETRIDE_FALKORDB_GRAPH}"`);
      }
    } finally {
      await db.close();
    }
  } catch (err) {
    fail(`FalkorDB unreachable: ${(err as Error).message}`);
    failures++;
  }

  // 4. Start the pipeline on the runtime for real, then stop it again.
  const { auth, uri } = rocketRideCredentials();
  if (!auth) {
    warn("ROCKETRIDE_APIKEY not set — skipping the runtime start; the demo will use the local threshold agents");
    warnings++;
  } else {
    const client = new RocketRideClient({ auth, uri, env, module: "warehouse-memory-network" });
    try {
      const account = await client.connect();
      ok(`connected to ${uri} as ${account?.displayName || account?.email || "authenticated user"}`);

      const { token } = await client.use({ pipeline, useExisting: true, name: "preflight" });
      ok(`runtime started pipeline.pipe — token ${String(token).slice(0, 8)}…`);
      await client.terminate(token);
      ok("pipeline terminated — the next run will pick up the current file");
    } catch (err) {
      fail(`runtime could not start pipeline.pipe: ${(err as Error).message}`);
      failures++;
    } finally {
      await client.disconnect();
    }
  }

  console.log(
    `\n${failures === 0 ? "READY" : "NOT READY"} — ${failures} failure(s), ${warnings} warning(s)\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nCheck crashed: ${(err as Error).message}\n`);
  process.exit(1);
});
