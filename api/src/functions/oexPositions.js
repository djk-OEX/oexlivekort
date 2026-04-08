// ============================================================
// OEX LIVE POSITIONS – Azure Functions v4 (Node.js)
//
// GET  /api/oex/positions
//   Reads all live OEX positions from Azure Table Storage and
//   returns a JSON array:
//   [{ user: string, lat: number, lon: number, lastSeen: string|null }, …]
//
// POST /api/oex/positions
//   Upserts a single live position.  Body (JSON):
//   { user: string, lat: number, lon: number }
//   Each user occupies one row (PartitionKey="live", RowKey=user).
//   lastSeen is set to the current UTC timestamp on every write.
//
// Required environment variable:
//   POSITIONS_CONNECTION_STRING – Azure Storage connection string
//   POSITIONS_TABLE_NAME        – Table name (default: "OexPositions")
// ============================================================

'use strict';

const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

const TABLE_NAME = process.env.POSITIONS_TABLE_NAME || 'OexPositions';

// Helper: return { ok: true, client } or { ok: false, response } so callers
// can distinguish a ready TableClient from a pre-built error HTTP response.
function resolveClient(context) {
  const connectionString = process.env.POSITIONS_CONNECTION_STRING;
  if (!connectionString) {
    context.error('[OEX Positions] POSITIONS_CONNECTION_STRING is not set.');
    return {
      ok: false,
      response: {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Service not configured.' })
      }
    };
  }
  return { ok: true, client: TableClient.fromConnectionString(connectionString, TABLE_NAME) };
}

// ── GET /api/oex/positions ────────────────────────────────────────────────────
app.http('oexPositions', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'oex/positions',
  handler: async (request, context) => {
    const result = resolveClient(context);
    if (!result.ok) return result.response;

    try {
      const positions = [];

      for await (const entity of result.client.listEntities()) {
        const lat = Number(entity.lat);
        const lon = Number(entity.lon);

        // Skip entries that lack a valid user name or coordinates.
        if (
          typeof entity.user !== 'string' || entity.user.trim().length === 0 ||
          !Number.isFinite(lat) || lat < -90 || lat > 90 ||
          !Number.isFinite(lon) || lon < -180 || lon > 180
        ) {
          continue;
        }

        positions.push({
          user: entity.user,
          lat,
          lon,
          lastSeen: entity.lastSeen || null
        });
      }

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(positions)
      };
    } catch (err) {
      context.error('[OEX Positions] Failed to read from Table Storage:', err);
      return {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to fetch positions.' })
      };
    }
  }
});

// ── POST /api/oex/positions ───────────────────────────────────────────────────
app.http('oexPositionsIngest', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'oex/positions',
  handler: async (request, context) => {
    const result = resolveClient(context);
    if (!result.ok) return result.response;

    let body;
    try {
      body = await request.json();
    } catch {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Request body must be valid JSON.' })
      };
    }

    const { user, lat, lon } = body || {};
    const latNum = Number(lat);
    const lonNum = Number(lon);

    if (
      typeof user !== 'string' || user.trim().length === 0 ||
      !Number.isFinite(latNum) || latNum < -90 || latNum > 90 ||
      !Number.isFinite(lonNum) || lonNum < -180 || lonNum > 180
    ) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing or invalid fields: user (string), lat (number), lon (number).' })
      };
    }

    try {
      await result.client.upsertEntity(
        {
          partitionKey: 'live',
          rowKey: user.trim(),
          user: user.trim(),
          lat: latNum,
          lon: lonNum,
          lastSeen: new Date().toISOString()
        },
        'Replace'
      );

      return {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true })
      };
    } catch (err) {
      context.error('[OEX Positions] Failed to write to Table Storage:', err);
      return {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to save position.' })
      };
    }
  }
});
