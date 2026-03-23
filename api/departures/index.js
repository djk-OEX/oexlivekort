// api/departures/index.js
// Simpelt departures-endpoint til Azure Functions (HTTP GET /api/departures?stopId=xxx)
// Læser en lokal GTFS ZIP (api/gtfs.zip), parser relevante tabeller og returnerer næste afgange.
// POC: Planlagte tider (GTFS). Realtid (SIRI) kan kobles på senere.

// Dependencies defineret i api/package.json: unzipper, csv-parse
import path from "path";
import { promises as fs } from "fs";
import unzipper from "unzipper";
import { parse } from "csv-parse/sync";

/** Cache i memory for hurtig svartid i Function runtime */
let GTFS = null;
let GTFS_LOADED_AT = null;

/** Hjælp: parse HH:MM:SS til minutter siden midnat */
function hhmmssToMinutes(hhmmss) {
  if (!hhmmss) return null;
  const parts = hhmmss.split(":").map(n => parseInt(n, 10));
  const h = parts[0] || 0, m = parts[1] || 0, s = parts[2] || 0;
  return h * 60 + m + Math.floor(s / 60);
}

/** Hjælp: “nu” i minutter siden midnat (lokal server-tid) */
function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/** Load/parse GTFS.zip én gang (eller ved cold start) */
async function loadGTFS() {
  if (GTFS) return GTFS;

  const zipPath = path.join(process.cwd(), "api", "gtfs.zip");
  // Tjek at filen findes
  await fs.access(zipPath);

  const directory = await unzipper.Open.file(zipPath);

  // Læs .txt filer ind i memory
  const tables = {};
  const needed = new Set([
    "stops.txt",
    "routes.txt",
    "trips.txt",
    "stop_times.txt",
    "calendar.txt",
    "calendar_dates.txt"
  ]);

  for (const f of directory.files) {
    if (needed.has(f.path)) {
      const buf = await f.buffer();
      tables[f.path] = parse(buf.toString("utf8"), { columns: true, skip_empty_lines: true });
    }
  }

  // Byg simple indeks for hurtigere opslag
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
  // Sorter pr. stop efter afgangstid (hurtigere filtrering)
  for (const [sid, list] of stopTimesByStop.entries()) {
    list.sort((a, b) => hhmmssToMinutes(a.departure_time) - hhmmssToMinutes(b.departure_time));
  }

  GTFS = {
    raw: tables,
    tripsById,
    routesById,
    stopTimesByStop
  };
  GTFS_LOADED_AT = new Date();
  return GTFS;
}

/** Azure Function handler */
export default async function (context, req) {
  try {
    const stopId = (req.query.stopId || "").trim();
    if (!stopId) {
      context.res = { status: 400, body: "Missing query parameter: ?stopId" };
      return;
    }

    // Load GTFS-data
    const { stopTimesByStop, tripsById, routesById } = await loadGTFS();

    const list = stopTimesByStop.get(stopId) || [];

    const nowMin = nowMinutes();
    const windowMin = 6 * 60; // vis højst 6 timer frem (kan tweakes)
    const lowerBound = nowMin - 2; // 2 min tolerance bagud
    const upperBound = nowMin + windowMin;

    // Filtrer på afgangstidspunkt (minutter siden midnat)
    const upcoming = [];
    for (const st of list) {
      const dep = hhmmssToMinutes(st.departure_time);
      if (dep === null) continue;
      if (dep < lowerBound) continue;
      if (dep > upperBound) break; // liste er sorteret

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

      if (upcoming.length >= 12) break; // returnér max 12 linjer
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
