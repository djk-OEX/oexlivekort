// ============================================================
// OEX LIVE POSITIONS – Azure Functions v4 (Node.js)
//
// Backed by the same Azure Table Storage table ("OexPositions")
// as the oex-gps-function app, so both services share one store.
//
// Field names and HTTP semantics intentionally mirror oex-gps-function
// (C#) so either backend can serve the same clients:
//
// GET  /api/oex/positions   – anonymous
//   Returns all positions:
//   [{ user, lat, lon, lastSeen }, …]
//
// POST /api/oex/positions   – function key required
//   Upserts a single position.  Body (JSON, case-insensitive):
//   { user, lat, lon, timestamp? }   (also accepts PascalCase for backwards compatibility)
//   timestamp (the position fix time) is stored and returned as lastSeen.
//   Timestamp defaults to server time when omitted.
//   Returns 200 OK on success.
//
// Requires app setting: POSITIONS_CONNECTION_STRING
// ============================================================

'use strict';

const { app } = require('@azure/functions');
const { TableClient, odata } = require('@azure/data-tables');

const PARTITION_KEY = 'OEX';
const TABLE_NAME = 'OexPositions';

function getTableClient() {
  const connectionString = process.env.POSITIONS_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error('POSITIONS_CONNECTION_STRING is not set.');
  }
  return TableClient.fromConnectionString(connectionString, TABLE_NAME);
}

// ── GET /api/oex/positions ────────────────────────────────────────────────────
app.http('oexPositions', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'oex/positions',
  handler: async () => {
    const client = getTableClient();
    const results = [];
    for await (const entity of client.listEntities({
      queryOptions: { filter: odata`PartitionKey eq ${PARTITION_KEY}` }
    })) {
      results.push({
        user: entity.rowKey,
        lat: entity.lat ?? entity.Lat,
        lon: entity.lon ?? entity.Lon,
        lastSeen: entity.lastSeen ?? entity.LastSeen
      });
    }
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(results)
    };
  }
});

// ── POST /api/oex/positions ───────────────────────────────────────────────────
app.http('oexPositionsIngest', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'oex/positions',
  handler: async (request) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return { status: 400, body: 'Invalid JSON payload.' };
    }

    // Accept both PascalCase and lowercase field names.
    const rawUser = body.User ?? body.user;
    const user = (typeof rawUser === 'string' ? rawUser : '').trim();
    const lat = Number(body.Lat ?? body.lat);
    const lon = Number(body.Lon ?? body.lon);
    const rawTimestamp = body.Timestamp ?? body.timestamp;
    const timestamp = (typeof rawTimestamp === 'string' && rawTimestamp)
      ? rawTimestamp
      : new Date().toISOString();

    if (!user) {
      return { status: 400, body: 'User is required.' };
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return { status: 400, body: 'Lat must be between -90 and 90.' };
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      return { status: 400, body: 'Lon must be between -180 and 180.' };
    }

    const client = getTableClient();
    await client.upsertEntity(
      {
        partitionKey: PARTITION_KEY,
        rowKey: user,
        lat: lat,
        lon: lon,
        lastSeen: timestamp
      },
      'Replace'
    );

    return { status: 200 };
  }
});
