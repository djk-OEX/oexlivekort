// api/stops/index.js
// Helper: find stopId fra GTFS via navn eller geografi.

import unzipper from "unzipper";
import { parse } from "csv-parse/sync";

// Samme GTFS URL som i departures:
const GTFS_URL = "https://oexazfilkonto.blob.core.windows.net/gtfs/GTFS.zip";

let GTFS = null;

async function loadGTFS() {
  if (GTFS) return GTFS;

  const resp = await fetch(GTFS_URL, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Failed to fetch GTFS.zip: ${resp.status} ${resp.statusText}`);
  const buffer = Buffer.from(await resp.arrayBuffer());

  const dir = await unzipper.Open.buffer(buffer);
  const entry = dir.files.find(f => f.path === "stops.txt");
  if (!entry) throw new Error("stops.txt not found in GTFS");
  const stopsCsv = await entry.buffer();
  const stops = parse(stopsCsv.toString("utf8"), { columns: true, skip_empty_lines: true });

  // Parse lat/lon
  for (const s of stops) {
    s.stop_lat = parseFloat(s.stop_lat);
    s.stop_lon = parseFloat(s.stop_lon);
  }

  GTFS = { stops };
  return GTFS;
}

function haversine(lat1, lon1, lat2, lon2) {
  const toRad = d => (d * Math.PI) / 180;
  const R = 6371000; // m
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export default async function (context, req) {
  try {
    const { stops } = await loadGTFS();

    const name = (req.query.name || "").trim();
    const lat = req.query.lat ? parseFloat(req.query.lat) : null;
    const lon = req.query.lon ? parseFloat(req.query.lon) : null;
    const radius = req.query.radius ? parseInt(req.query.radius, 10) : 500; // m
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;

    let results = stops;

    if (name) {
      const n = name.toLowerCase();
      results = results.filter(s => (s.stop_name || "").toLowerCase().includes(n));
    }

    if (lat != null && lon != null) {
      results = results
        .map(s => ({
          ...s,
          distance: haversine(lat, lon, s.stop_lat, s.stop_lon)
        }))
        .filter(s => s.distance <= radius)
        .sort((a, b) => a.distance - b.distance);
    }

    results = results.slice(0, limit).map(s => ({
      stopId: s.stop_id,
      stopName: s.stop_name,
      lat: s.stop_lat,
      lon: s.stop_lon
    }));

    context.res = {
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ count: results.length, data: results })
    };
  } catch (err) {
    context.log.error(err);
    context.res = { status: 500, body: "Server error: " + err.message };
  }
}
