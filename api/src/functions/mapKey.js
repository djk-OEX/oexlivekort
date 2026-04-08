// ============================================================
// MAP KEY – Azure Functions v4 (Node.js)
// Route: GET /api/mapkey
//
// Returns the Azure Maps subscription key from an environment
// variable so it is never committed to source control.
//
// Required environment variable:
//   AZURE_MAPS_KEY – Azure Maps subscription key
// ============================================================

'use strict';

const { app } = require('@azure/functions');

app.http('mapKey', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'mapkey',
  handler: async (request, context) => {
    const key = process.env.AZURE_MAPS_KEY;
    if (!key) {
      context.error('[OEX MapKey] AZURE_MAPS_KEY is not set.');
      return {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Map key not configured.' })
      };
    }

    return {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // Allow the browser to cache the key for 5 minutes.
        'Cache-Control': 'private, max-age=300'
      },
      body: JSON.stringify({ key })
    };
  }
});
