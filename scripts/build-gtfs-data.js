#!/usr/bin/env node
/**
 * build-gtfs-data.js
 * ------------------
 * Pre-processor GTFS-data for Danmark til kompakte JSON-filer:
 *   data/stops.json
 *   data/stop_routes.json
 *   data/routes.json
 *   data/route_stops.json
 *   data/trips_headsign.json
 *   data/shapes.json
 *   data/trip_to_shape.json
 *   data/route_to_shape.json
 *   data/departures_5min/*.json
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── helpers ──────────────────────────────────────────────────────────────────

function parseCSVLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      fields.push(field); field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const headers = parseCSVLine(lines[0]).map(h => h.trim().replace(/^\uFEFF/, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = parseCSVLine(line);
    const row = {};
    headers.forEach((h, idx) => row[h] = (vals[idx] || '').trim());
    rows.push(row);
  }
  return rows;
}

async function readGtfsFiles(gtfsPath) {
  const stat = fs.statSync(gtfsPath);
  if (stat.isDirectory()) {
    return {
      readFile: name => {
        const fp = path.join(gtfsPath, name);
        if (!fs.existsSync(fp)) return null;
        return fs.readFileSync(fp, 'utf8');
      }
    };
  }
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(gtfsPath);
  return {
    readFile: name => {
      const entry = zip.getEntry(name);
      if (!entry) return null;
      return entry.getData().toString('utf8');
    }
  };
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const gtfsPath = path.resolve(process.argv[2]);
  const outDir = path.resolve(__dirname, '../data');
  fs.mkdirSync(outDir, { recursive: true });

  const reader = await readGtfsFiles(gtfsPath);

  // ── stops ───────────────────────────────
  const stops = parseCSV(reader.readFile('stops.txt'))
    .filter(r => r.stop_lat && r.stop_lon && (!r.location_type || r.location_type === '0'))
    .map(r => ({
      id: r.stop_id,
      name: r.stop_name,
      lat: +r.stop_lat,
      lng: +r.stop_lon
    }));
  fs.writeFileSync(path.join(outDir, 'stops.json'), JSON.stringify(stops));

  // ── routes ──────────────────────────────
  const routes = parseCSV(reader.readFile('routes.txt'));
  const routeMap = {};
  routes.forEach(r => routeMap[r.route_id] = r.route_short_name || r.route_id);
  fs.writeFileSync(path.join(outDir, 'routes.json'), JSON.stringify(
    routes.map(r => ({
      route_id: r.route_id,
      route_short_name: r.route_short_name || '',
      route_long_name: r.route_long_name || ''
    }))
  ));

  // ── trips ───────────────────────────────
  const tripRows = parseCSV(reader.readFile('trips.txt'));
  const tripMap = {};
  tripRows.forEach(t => {
    tripMap[t.trip_id] = { routeId: t.route_id, headsign: t.trip_headsign || '' };
  });

  const tripsHeadsignOut = {};
  tripRows.forEach(t => { if (t.trip_headsign) tripsHeadsignOut[t.trip_id] = t.trip_headsign; });
  fs.writeFileSync(path.join(outDir, 'trips_headsign.json'), JSON.stringify(tripsHeadsignOut));

  // ── shapes ──────────────────────────────
  const shapesText = reader.readFile('shapes.txt');
  if (shapesText) {
    const tripToShape = {};
    tripRows.forEach(t => { if (t.trip_id && t.shape_id) tripToShape[t.trip_id] = t.shape_id; });

    const shapeRows = parseCSV(shapesText);
    const shapePts = {};
    shapeRows.forEach(r => {
      if (!shapePts[r.shape_id]) shapePts[r.shape_id] = [];
      shapePts[r.shape_id].push([+r.shape_pt_sequence, +r.shape_pt_lon, +r.shape_pt_lat]);
    });

    const shapesOut = {};
    Object.entries(shapePts).forEach(([sid, pts]) => {
      pts.sort((a, b) => a[0] - b[0]);
      shapesOut[sid] = pts.map(p => [p[1], p[2]]);
    });

    fs.writeFileSync(path.join(outDir, 'shapes.json'), JSON.stringify(shapesOut));
    fs.writeFileSync(path.join(outDir, 'trip_to_shape.json'), JSON.stringify(tripToShape));

    const routeToShape = {};
    tripRows.forEach(t => {
      if (t.route_id && t.shape_id && !routeToShape[t.route_id])
        routeToShape[t.route_id] = t.shape_id;
    });
    fs.writeFileSync(path.join(outDir, 'route_to_shape.json'), JSON.stringify(routeToShape));
  }

  // ── departures_5min ─────────────────────
  const stopTimes = parseCSV(reader.readFile('stop_times.txt'));
  const departureSlots = {};

  stopTimes.forEach(r => {
    const trip = tripMap[r.trip_id];
    if (!trip) return;

    const depTime = r.departure_time || '';
    const arrTime = r.arrival_time || '';
    const t = depTime || arrTime;
    if (!t) return;

    const [h, m] = t.split(':').map(Number);
    const slot = String(h).padStart(2, '0') + '_' + String(Math.floor(m / 5) * 5).padStart(2, '0');

    departureSlots[slot] ||= {};
    departureSlots[slot][r.stop_id] ||= [];

    const entry = {
      route_id:   trip.routeId,
      trip_id:    r.trip_id,            // ✅ FIX
      short_name: routeMap[trip.routeId],
      arrival:    arrTime,
      departure:  depTime
    };
    if (trip.headsign) entry.headsign = trip.headsign;

    departureSlots[slot][r.stop_id].push(entry);
  });

  const depDir = path.join(outDir, 'departures_5min');
  fs.mkdirSync(depDir, { recursive: true });
  Object.entries(departureSlots).forEach(([k, v]) => {
    fs.writeFileSync(path.join(depDir, `${k}.json`), JSON.stringify(v));
  });

  console.log('✅ GTFS build færdig');
}

main().catch(e => {
  console.error(e);
