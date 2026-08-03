/**
 * Loads .env into process.env using Node's built-in loader (no dependency).
 * Import this first in any entry script. Safe if .env is missing.
 */
import { existsSync } from "node:fs";

const envPath = new URL("../.env", import.meta.url);
try {
  if (existsSync(envPath)) {
    // Available in Node 20.12+ / 21.7+.
    (process as any).loadEnvFile(envPath);
  }
} catch {
  // Non-fatal: fall back to whatever is already in process.env.
}
