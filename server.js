// server.js — Zero-dependency demo relay server.
// Serves the UI at "/" and relays JSON events between:
//   - LaserData mock button / any real feed  -> POST /event {"type":"trigger", "payload": {...}}
//   - Person 1 / Person 2's agents           -> POST /event {"type":"risk_agent"|"mode_agent"|"rocketride", ...}
//   - The browser UI                          -> GET  /events (Server-Sent Events stream)
//
// No npm install needed. Just: node server.js

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

let clients = [];       // open SSE response objects
let lastTrigger = null; // last trigger payload, replayed to late-joining clients (e.g. Person 1/2's dashboards)

function sendEvent(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(msg) {
  clients.forEach((res) => sendEvent(res, msg));
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
      if (msg.type === 'trigger') lastTrigger = msg;
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
