/**
 * WebSocket hub — FR-WEB-005 (live telemetry views shall update via
 * WebSocket without page refresh). Web_App_Pending_Items.md W3.
 *
 * One WS server, attached to the same HTTP server as Express, at path
 * `/ws`. A browser WebSocket cannot send an Authorization header on the
 * initial handshake, so the access token travels as a query string param
 * (`?token=`) — the same short-lived 15-minute token used everywhere
 * else, not a new credential type.
 *
 * Tenant scoping mirrors getPumpInScope() in server.js: a connection is
 * tagged with the caller's role and hierarchy_path at auth time, and
 * every broadcast is filtered per-connection against that path before
 * sending — the same prefix-match the REST layer uses, just applied at
 * fan-out instead of in a WHERE clause. This is a stopgap, not a
 * replacement for the Postgres RLS recommended in Backend_Pending_Items.md
 * §3.1 — that closes the gap at the data layer for every current and
 * future caller; this only closes it for this one broadcast path.
 */
const { WebSocketServer } = require('ws');
const { verifyToken } = require('./jwtAuth');

const HEARTBEAT_MS = 30000;

/** @type {Set<{ws: import('ws').WebSocket, userId: string, role: string, hierarchyPath: string, isAlive: boolean}>} */
const clients = new Set();

function inScope(client, hierarchyPath) {
  if (client.role === 'superadmin') return true;
  return typeof hierarchyPath === 'string' && hierarchyPath.startsWith(client.hierarchyPath);
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastPumpUpdate(pump) {
  // hierarchy_path drives the scoping check below but has no reason to
  // leave the server once that check has run.
  const { hierarchy_path, ...pumpPayload } = pump;
  for (const client of clients) {
    if (inScope(client, hierarchy_path)) send(client.ws, { type: 'pump_update', pump: pumpPayload });
  }
}

function broadcastFault(pumpId, hierarchyPath, fault) {
  for (const client of clients) {
    if (inScope(client, hierarchyPath)) send(client.ws, { type: 'fault', pump_id: pumpId, fault });
  }
}

function broadcastConfigUpdate(pumpId, hierarchyPath, config) {
  for (const client of clients) {
    if (inScope(client, hierarchyPath)) send(client.ws, { type: 'config_update', pump_id: pumpId, config });
  }
}

// Alert engine delivery (FR-WEB-060/062) is per-subscriber, not
// per-hierarchy-scope like the broadcasts above — a user's subscription
// rows can narrow who gets notified below what their scope would
// otherwise allow. Users not currently connected are simply skipped; the
// alerts row itself is the durable record for them to see later.
function sendToUsers(userIds, payload) {
  if (!userIds || userIds.length === 0) return;
  const idSet = new Set(userIds);
  for (const client of clients) {
    if (idSet.has(client.userId)) send(client.ws, payload);
  }
}

function attachWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const payload = token ? verifyToken(token) : null;

    if (!payload) {
      send(ws, { type: 'error', message: 'Authentication required' });
      ws.close(4001, 'Unauthorized');
      return;
    }

    const client = {
      ws,
      userId: payload.id,
      role: payload.role,
      hierarchyPath: payload.hierarchy_path || '',
      isAlive: true
    };
    clients.add(client);
    send(ws, { type: 'connected' });

    ws.on('pong', () => {
      client.isAlive = true;
    });
    ws.on('close', () => {
      clients.delete(client);
    });
    ws.on('error', () => {
      clients.delete(client);
    });
  });

  // Drop dead connections (e.g. laptop sleep, network drop without a clean
  // close frame) so `clients` doesn't grow unbounded on a long-running process.
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.isAlive) {
        client.ws.terminate();
        clients.delete(client);
        continue;
      }
      client.isAlive = false;
      client.ws.ping();
    }
  }, HEARTBEAT_MS);
  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}

module.exports = { attachWebSocketServer, broadcastPumpUpdate, broadcastFault, broadcastConfigUpdate, sendToUsers };
