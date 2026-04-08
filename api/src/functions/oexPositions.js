// ============================================================
// OEX LIVE POSITIONS – Azure Functions v4 (Node.js)
// Route: GET /api/oex/positions
//
// Reads live OEX positions from Azure Table Storage and returns
// a JSON array of:
//   [{ user: string, lat: number, lon: number, lastSeen: string|null }, …]
//
// Required environment variable:
//   POSITIONS_CONNECTION_STRING – Azure Storage connection string
//   POSITIONS_TABLE_NAME        – Table name (default: "OexPositions")
// ============================================================

'use strict';

const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

const TABLE_NAME = process.env.POSITIONS_TABLE_NAME || 'OexPositions';

app.http('oexPositions', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'oex/positions',
  handler: async (request, context) => {
    const connectionString = process.env.POSITIONS_CONNECTION_STRING;
    if (!connectionString) {
      context.error('[OEX Positions] POSITIONS_CONNECTION_STRING is not set.');
      return {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Service not configured.' })
      };
    }

    try {
      const client = TableClient.fromConnectionString(connectionString, TABLE_NAME);
      const positions = [];

      for await (const entity of client.listEntities()) {
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
