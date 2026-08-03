# ColdRelief-500 Live Pipeline Demo

Zero build step, zero `npm install`. One command to run.

## Run it

```
node server.js
```

Open **http://localhost:3000** in a browser. That's it.

If port 3000 is taken: `PORT=3001 node server.js`.

## What's in here

- `server.js` — plain Node `http` server, no dependencies. Serves the UI and relays JSON events between whoever sends them and whoever's watching, using Server-Sent Events (SSE). One process, one file, nothing to install — this is the most likely thing to *not* break on stage.
- `public/index.html` — the three-panel UI (network map, mode comparison table, live log). All CSS/JS is inline in this one file.

## On LaserData

There's no off-the-shelf live feed that emits this exact custom shape (`flu_outbreak` / `hub` / `demand_multiplier`), and wiring up a real external streaming account mid-hackathon would mean creating accounts/API keys — not something to do live under time pressure anyway. So this goes straight to option (b): the **Fire Trigger** button in the UI POSTs the *exact* JSON from your spec to `/event`:

```json
{ "event": "flu_outbreak", "hub": "Ohio", "product": "ColdRelief-500", "demand_multiplier": 3.2 }
```

If a real LaserData feed becomes available before the demo, point it at the same endpoint (see below) and delete the button — the rest of the pipeline doesn't need to change.

## Integration contract — for Person 1 / Person 2

Whatever your agents are built in (Python, a notebook, curl in a loop, whatever), just **POST JSON to the same server**:

```
POST http://localhost:3000/event
Content-Type: application/json
```

The UI listens on an SSE stream and re-renders on every message. Five message types:

**1. Trigger** (normally sent by the "Fire Trigger" button — LaserData mock)
```json
{ "type": "trigger", "payload": { "event": "flu_outbreak", "hub": "Ohio", "product": "ColdRelief-500", "demand_multiplier": 3.2 } }
```

**2. Risk Agent output** — appears in the log panel
```json
{ "type": "risk_agent", "payload": { "message": "Ohio covers ~1.4 days at 3.2x demand — stockout in <48h.", "stockout_hours": 34 } }
```

**3. Mode Agent output** — appears in the log, and highlights a row in the comparison table if `recommended_mode` is one of `rail` / `truck` / `air`
```json
{ "type": "mode_agent", "payload": { "message": "Recommending truck — fastest option under the cost ceiling.", "recommended_mode": "truck" } }
```

**4. RocketRide execution confirmation** — appears in the log, marks the executed mode, and updates the LA→Ohio line on the map
```json
{ "type": "rocketride", "payload": { "message": "Truck dispatched via RocketRide.", "confirmation_id": "RR-48213", "eta_hours": 30 } }
```

**5. Reset** — snaps the whole UI (all connected screens) back to baseline
```json
{ "type": "reset" }
```

Only `type` is required. `payload.message` is what shows up in the log — if you skip it, a generic fallback line is shown. Extra fields are ignored harmlessly, so feel free to send whatever else your agent produces.

Quick test from a terminal:
```bash
curl -X POST http://localhost:3000/event -H "Content-Type: application/json" \
  -d '{"type":"risk_agent","payload":{"message":"Stockout risk in 34 hours"}}'
```

## Built-in safety net

The **Simulate Agents** button (enabled after Fire Trigger) plays a canned risk → mode → RocketRide sequence through the exact same `/event` endpoint real agents use. If Person 1/2's code isn't ready, isn't running, or flakes mid-demo, click this instead — the UI can't tell the difference between a real and simulated message, so the on-stage behavior is identical either way. This is the fallback to lean on if you want a guaranteed-to-work run.

## Multiple screens

Since state lives on the server and broadcasts over SSE, you can open the UI on more than one laptop/monitor pointed at the same server and they'll all update together — handy if Person 1/2 want to watch their own output land live next to yours.
