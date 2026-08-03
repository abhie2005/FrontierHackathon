/**
 * Shared FalkorDB connection.
 * Works against local Docker (default localhost:6379) or FalkorDB Cloud
 * (set FALKORDB_HOST / PORT / USERNAME / PASSWORD in .env).
 */
import { FalkorDB } from "falkordb";

const GRAPH_NAME = process.env.FALKORDB_GRAPH ?? "warehouse";

export async function connect() {
  const host = process.env.FALKORDB_HOST ?? "localhost";
  const port = Number(process.env.FALKORDB_PORT ?? 6379);
  const username = process.env.FALKORDB_USERNAME || undefined;
  const password = process.env.FALKORDB_PASSWORD || undefined;

  const db = await FalkorDB.connect({
    username,
    password,
    socket: { host, port },
  });

  const graph = db.selectGraph(GRAPH_NAME);
  return { db, graph, graphName: GRAPH_NAME };
}

export type Graph = Awaited<ReturnType<typeof connect>>["graph"];
