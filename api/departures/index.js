// api/departures/index.js
// Henter GTFS.zip fra Azure Blob Storage og returnerer næste afgange for ?stopId=xxx

import unzipper from "unzipper";
import { parse } from "csv-parse/sync";

// >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
// Sæt din offentlige Blob-URL herunder (kan også flyttes til env var GTFS_URL):
const GTFS_URL = "https://oexazfilkonto.blob.core.windows.net/gtfs/GTFS.zip";
// <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

let GTFS = null;

// Hjælpere
function hhmmssToMinutes(hhmmss) {
  if (!hhmmss) return null;
  const [h, m, s] = hhmmss.split(":").map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0) + Math.floor((s || 0) / 60);
}
function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

async function loadGTFS() {
  if (GTFS) return GTFS;

  // Hent ZIP til memory
  const resp = await fetch(GTFS_URL, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Failed to fetch GTFS.zip: ${resp.status} ${resp.statusText}`);
  const arrayBuf = await resp.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);

  // Åbn ZIP fra buffer
  const directory = await unzipper.Open.buffer(buffer);

  // Læs relevante .txt filer
  const need = new Set([
    "stops.txt",
    "routes.txt",
    "trips.txt",
    "stop_times.txt",
    "calendar.txt",
    "calendar_dates.txt"
  ]);
  const tables = {};

  for (const entry of directory.files) {
    if (need.has(entry.path)) {
      const content = await entry.buffer();
      tables[entry.path] = parse(content.toString("utf8"), {
        columns: true,
        skip_empty_lines: true
      });
    }
  }

  // Indeks
  const tripsById = new Map();
  for (const t of tables["trips.txt"] || []) tripsById.set(t.trip_id, t);

  const routesById = new Map();
  for (const r of tables["routes.txt"] || []) routesById.set(r.route_id, r);

  const stopTimesByStop = new Map();
  for (const st of tables["stop_times.txt"] || []) {
    const list = stopTimesByStop.get(st.stop_id) || [];
    list.push(st);
    stopTimesByStop.set(st.stop_id, list);
  }
  for (const [sid, list] of stopTimesByStop.entries()) {
    list.sort((a, b) => hhmmssToMinutes(a.departure_time) - hhmmssToMinutes(b.departure_time));
  }

  GTFS = { raw: tables, tripsById, routesById, stopTimesByStop };
  return GTFS;
}

export default async function (context, req) {
  try {
    const stopId = (req.query.stopId || "").trim();
    if (!stopId) {
      context.res = { status: 400, body: "Missing query parameter: ?stopId" };
      return;
    }

    const { stopTimesByStop, tripsById, routesById } = await loadGTFS();
    const list = stopTimesByStop.get(stopId) || [];

    const nowMin = nowMinutes();
    const lowerBound = nowMin - 2;      // 2 min tolerance
    const upperBound = nowMin + 6 * 60; // 6 timer frem
    const upcoming = [];

    for (const st of list) {
      const dep = hhmmssToMinutes(st.departure_time);
      if (dep == null) continue;
      if (dep < lowerBound) continue;
      if (dep > upperBound) break;

      const trip = tripsById.get(st.trip_id);
      if (!trip) continue;
      const route = routesById.get(trip.route_id) || {};

      upcoming.push({
        stopId,
        tripId: st.trip_id,
        routeId: trip.route_id,
        routeShortName: route.route_short_name || "",
        routeLongName: route.route_long_name || "",
        headsign: trip.trip_headsign || "",
        departureTime: st.departure_time,
        minutesUntil: dep - nowMin
      });

      if (upcoming.length >= 12) break;
    }

    context.res = {
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        stopId,
        count: upcoming.length,
        generatedAt: new Date().toISOString(),
        data: upcoming
      })
    };
  } catch (err) {
    context.log.error(err);
    context.res = { status: 500, body: "Server error: " + err.message };
  }
}
