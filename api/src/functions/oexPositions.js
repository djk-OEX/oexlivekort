// ============================================================
// OEX LIVE POSITIONS – Azure Functions v4 (Node.js)
//
// GET  /api/oex/positions
//   Returns all current live positions as a JSON array:
//   [{ user: string, lat: number, lon: number, lastSeen: string }, …]
//
// POST /api/oex/positions
//   Upserts a single live position.  Body (JSON):
//   { user: string, lat: number, lon: number }
//
// Positions are kept in-memory (a Map keyed by user name).
// No external storage is required.
// ============================================================

'use strict';

const { app } = require('@azure/functions');

// In-memory store: user → { user, lat, lon, lastSeen }
const positions = new Map();

// ── GET /api/oex/positions ────────────────────────────────────────────────────
app.http('oexPositions', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'oex/positions',
  handler: async () => {
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Array.from(positions.values()))
    };
  }
});

// ── POST /api/oex/positions ───────────────────────────────────────────────────
app.http('oexPositionsIngest', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'oex/positions',
  handler: async (request) => {
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

    positions.set(user.trim(), {
      user: user.trim(),
      lat: latNum,
      lon: lonNum,
      lastSeen: new Date().toISOString()
    });

    return {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true })
    };
  }
});
