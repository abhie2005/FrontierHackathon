/**
 * Loads `pipeline.pipe` and prepares it for `client.use()`.
 *
 * Two things happen here that the SDK can't do for us:
 *
 *  1. **Numeric/boolean config.** RocketRide's `${ROCKETRIDE_*}` substitution only
 *     rewrites string values, but `tool_falkordb.port` / `.tls` are typed integer
 *     and boolean in the component schema. So the `.pipe` keeps literal defaults
 *     and we patch them from the environment here. Strings (host, graph, creds,
 *     API keys) stay as `${ROCKETRIDE_*}` placeholders and are resolved by the SDK.
 *  2. **Wrapper unwrapping** — `.pipe` files are sometimes saved as
 *     `{ "pipeline": { ... } }`. `use({ filepath })` unwraps that itself, but we
 *     pass a config object (so we can patch it), so we unwrap it ourselves.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PipelineConfig } from "rocketride";

/** Absolute path to the project's single pipeline definition. */
export const PIPE_PATH = fileURLToPath(new URL("../../pipeline.pipe", import.meta.url));

/**
 * The `ROCKETRIDE_*` variables the pipeline substitutes, derived from the
 * project's own env vars so FalkorDB credentials are configured in one place.
 * Explicit `ROCKETRIDE_*` values in the environment always win.
 */
export function rocketRideEnv(): Record<string, string> {
  const mirror = (rocketVar: string, appVar: string, fallback = "") =>
    process.env[rocketVar] ?? process.env[appVar] ?? fallback;

  return {
    ROCKETRIDE_FALKORDB_HOST: mirror("ROCKETRIDE_FALKORDB_HOST", "FALKORDB_HOST", "localhost"),
    ROCKETRIDE_FALKORDB_PORT: mirror("ROCKETRIDE_FALKORDB_PORT", "FALKORDB_PORT", "6379"),
    ROCKETRIDE_FALKORDB_USERNAME: mirror("ROCKETRIDE_FALKORDB_USERNAME", "FALKORDB_USERNAME"),
    ROCKETRIDE_FALKORDB_PASSWORD: mirror("ROCKETRIDE_FALKORDB_PASSWORD", "FALKORDB_PASSWORD"),
    ROCKETRIDE_FALKORDB_GRAPH: mirror("ROCKETRIDE_FALKORDB_GRAPH", "FALKORDB_GRAPH", "warehouse"),
    ROCKETRIDE_ANTHROPIC_KEY: mirror("ROCKETRIDE_ANTHROPIC_KEY", "ANTHROPIC_API_KEY"),
  };
}

/** API key + server URI for the SDK client, accepting either env spelling. */
export function rocketRideCredentials(): { auth: string; uri: string } {
  return {
    auth: process.env.ROCKETRIDE_APIKEY ?? process.env.ROCKETRIDE_API_KEY ?? "",
    uri: process.env.ROCKETRIDE_URI ?? "https://api.rocketride.ai",
  };
}

/** True when the RocketRide pipeline can actually run (key + LLM key present). */
export function isRocketRideConfigured(): boolean {
  if (process.env.ROCKETRIDE_PIPELINE === "0") return false;
  return Boolean(rocketRideCredentials().auth && rocketRideEnv().ROCKETRIDE_ANTHROPIC_KEY);
}

/** Read `pipeline.pipe`, unwrap it if needed, and patch the typed FalkorDB fields. */
export function loadPipelineConfig(path = PIPE_PATH): PipelineConfig {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const config = (raw.pipeline ?? raw) as PipelineConfig;

  const port = Number(rocketRideEnv().ROCKETRIDE_FALKORDB_PORT);
  const tls = (process.env.FALKORDB_TLS ?? "").toLowerCase() === "true";

  for (const component of config.components ?? []) {
    if (component.provider !== "tool_falkordb") continue;
    const cfg = component.config as Record<string, unknown>;
    if (Number.isFinite(port)) cfg.port = port;
    cfg.tls = tls;
  }

  return config;
}
