// server.js — Demo relay server, now with a real LaserData live-data leg.
// Flow for the trigger event (the flu-outbreak spike):
//   Fire Trigger button -> POST /event {type:"trigger"} -> published onto a LaserData topic
//   -> a LaserData consumer running in this process picks it up live -> broadcast() -> SSE -> browser
// So LaserData sits ON the causal path: unplug it and the trigger stops reaching the UI.
//
// Person 1 / Person 2's agent output (risk_agent, mode_agent, rocketride) still POSTs straight
// to /event and broadcasts directly — that's their own live pipeline, not LaserData's concern.
//
// If LASER_CONNECTION_STRING isn't set yet (e.g. still setting up the account), the server
// falls back to broadcasting the trigger directly so local dev/demo rehearsal keeps working —
// but it logs loudly that it's doing so, since that fallback path is NOT what judges should see.

import 'dotenv/config';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Laser } from '@laserdata/laser-sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const LASER_STREAM = process.env.LASER_STREAM || 'coldrelief';
const LASER_TOPIC = process.env.LASER_TOPIC || 'hub-events';

let clients = [];       // open SSE response objects
let lastTrigger = null; // last trigger payload, replayed to late-joining clients

function sendEvent(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(msg) {
  clients.forEach((res) => sendEvent(res, msg));
}

function applyIncomingTrigger(msg) {
  msg.ts = msg.ts || Date.now();
  lastTrigger = msg;
  broadcast(msg);
  console.log(`[laserdata] delivered trigger to ${clients.length} client(s):`, JSON.stringify(msg).slice(0, 200));
}

// --- LaserData wiring ---
// laserTopic is set once connected; used by the /event handler to publish triggers for real.
let laserTopic = null;

async function initLaserData() {
  const connStr = process.env.LASER_CONNECTION_STRING;
  if (!connStr) {
    console.warn(
      '[laserdata] LASER_CONNECTION_STRING is not set — falling back to direct relay for the trigger event.\n' +
      '            This is a LOCAL-ONLY fallback. Set the env var (see README) before the real demo.'
    );
    return;
  }

  // The SDK retries the handshake forever by default and never rejects on bad
  // credentials, which would hang this function silently. Cap retries and add
  // a hard timeout so a real connection problem surfaces as a clear error.
  const bounded = connStr.includes('?')
    ? `${connStr}&reconnection_retries=3&reconnection_interval=1s`
    : `${connStr}?reconnection_retries=3&reconnection_interval=1s`;
  const CONNECT_TIMEOUT_MS = 10_000;

  try {
    const laser = await Promise.race([
      Laser.connect(bounded),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('connect timed out after 10s — check host/credentials')), CONNECT_TIMEOUT_MS)
      ),
    ]);
    const topic = laser.stream(LASER_STREAM).topic(LASER_TOPIC);
    await topic.ensure(2);
    laserTopic = topic;
    console.log(`[laserdata] connected — stream="${LASER_STREAM}" topic="${LASER_TOPIC}"`);

    // Live consumer: this loop is what actually pushes trigger events into the UI.
    const consumer = await topic.consumerGroup('ui-relay', { startFrom: { kind: 'last' } });
    (async () => {
      for (;;) {
        try {
          const record = await consumer.nextWithin(5000);
          if (!record) continue; // idle poll tick, nothing published
          const msg = JSON.parse(Buffer.from(record.payload).toString('utf8'));
          applyIncomingTrigger(msg);
          await consumer.commit(record);
        } catch (err) {
          console.error('[laserdata] consumer error:', err.message);
        }
      }
    })();
  } catch (err) {
    // Known issue as of @laserdata/laser-sdk@0.0.1: the SDK's VSR client hard-refuses
    // TLS transport (apache-iggy client.config.js: "VSR framing currently supports the
    // TCP transport only"), and LaserData Cloud deployments are TLS-only — so this
    // currently can't succeed against a real cloud deployment. See README for details.
    console.error('[laserdata] failed to connect — falling back to direct relay:', err.message, `(kind: ${err.kind})`);
  }
}

const server = http.createServer((req, res) => {
  // Permissive CORS so teammates can POST from their own scripts/ports.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- SSE stream the UI listens to ---
  if (req.method === 'GET' && req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('\n');
    clients.push(res);
    if (lastTrigger) sendEvent(res, lastTrigger); // catch up late joiners
    req.on('close', () => {
      clients = clients.filter((c) => c !== res);
    });
    return;
  }

  // --- Ingest endpoint: LaserData mock, Risk Agent, Mode Agent, RocketRide all post here ---
  if (req.method === 'POST' && req.url === '/event') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      let msg;
      try {
        msg = JSON.parse(body || '{}');
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
        return;
      }
      if (!msg.type) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing "type" field. Use one of: trigger, risk_agent, mode_agent, rocketride, reset' }));
        return;
      }
      msg.ts = Date.now();

      if (msg.type === 'trigger') {
        if (laserTopic) {
          // Real path: publish onto LaserData, let the consumer loop deliver it back to broadcast().
          laserTopic.publish().json(msg).send()
            .then(() => console.log('[laserdata] published trigger:', JSON.stringify(msg).slice(0, 200)))
            .catch((err) => {
              console.error('[laserdata] publish failed, relaying directly instead:', err.message);
              applyIncomingTrigger(msg);
            });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, via: 'laserdata' }));
          return;
        }
        // No LaserData connection configured — local fallback only.
        applyIncomingTrigger(msg);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, via: 'direct-fallback' }));
        return;
      }

      if (msg.type === 'reset') lastTrigger = null;
      broadcast(msg);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, clients: clients.length }));
      console.log(`[event] type=${msg.type}`, JSON.stringify(msg).slice(0, 200));
    });
    return;
  }

  // --- Static file serving for the UI ---
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(PUBLIC_DIR, filePath);
  const ext = path.extname(filePath);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n  Demo UI:        http://localhost:${PORT}`);
  console.log(`  Teammates POST events to: http://localhost:${PORT}/event\n`);
});

initLaserData();
