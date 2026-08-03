# Deploy (Railway)

Two services from this one repo: FalkorDB (the graph) and Hopper (the API + UI).

## 1. FalkorDB service

- New Railway service → **Deploy a Docker Image** → `falkordb/falkordb:latest`.
- Expose port `6379` internally (no need to make it public).
- Add a volume mounted at `/data` so the graph survives restarts.
- Note the service's internal hostname, e.g. `falkordb.railway.internal`.

## 2. Hopper service (API + frontend)

- New Railway service → **Deploy from GitHub repo** (this repo). Railway will detect `Dockerfile` /
  `railway.json` automatically and build it.
- Set these environment variables:

  | Variable | Value |
  |---|---|
  | `FALKORDB_HOST` | internal hostname from step 1, e.g. `falkordb.railway.internal` |
  | `FALKORDB_PORT` | `6379` |
  | `FALKORDB_GRAPH` | `warehouse` |
  | `PORT` | `4000` |
  | `ROCKETRIDE_API_KEY` | optional — leave empty for logs-only mode |

- Generate a public domain for this service (Railway → Settings → Networking → Generate Domain).

## 3. Seed the graph (once, after both services are up)

Run once from your machine, pointed at the deployed FalkorDB:

```bash
FALKORDB_HOST=<public-or-tcp-proxy-host> FALKORDB_PORT=<port> npm run seed
```

(Railway can expose a TCP proxy for the FalkorDB service under Settings → Networking if you need to
seed from outside the private network.)

## 4. Verify

- `https://<your-domain>/api/health` → `{"ok":true,"falkordb":"connected"}`
- `https://<your-domain>/` → dashboard, "Fire Trigger" should run the real pipeline
- `https://<your-domain>/sponsors.html` → sponsor page

## Notes

- The app runs via `npx tsx src/server.ts` in the container (no build step) — fine for a hackathon
  demo, not meant for long-term production.
- Same Dockerfile works on Render or Fly.io if you'd rather use those instead of Railway; only the
  "two services + internal hostname" wiring step changes.
