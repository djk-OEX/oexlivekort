#!/usr/bin/env node
/**
 * build-gtfs-data.js
 * ------------------
 * Pre-processor GTFS-data for Danmark til kompakte JSON-filer:
 *   data/stops.json            – alle busstop: [{id, name, lat, lng}, ...]
 *   data/stop_routes.json      – stop_id → ruter: {"851459100": [{"line":"1A","headsigns":["Vanløse"]}, ...], ...}
 *   data/routes.json           – ruter: [{route_id, route_short_name, route_long_name}, ...]
 *   data/route_stops.json      – route_id → stop-id-liste: {"102785-25895_4": ["stop1","stop2",...], ...}
 *   data/trips_headsign.json   – trip_id → headsign (retningsskilt): {"trip123": "Aalborg", ...}
 *   data/departures_5min/*.json – 5-min afgangsvinduer: {"stop_id": [{route_id, short_name, headsign?, arrival, departure}, ...], ...}
 *
 * Brug:
 *   node scripts/build-gtfs-data.js /sti/til/gtfs-mappe
 *   node scripts/build-gtfs-data.js /sti/til/google_transit.zip
 *
 * GTFS-kilden til Danmark kan hentes fra:
 *   https://www.rejseplanen.info/labs/  (kræver registrering)
 *   https://gtfs.rejseplanen.dk/
 *
 * Output-filer skrives til data/ relativt til dette scripts placering (../data/).
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
  if (lines.length === 0) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.trim().replace(/^\uFEFF/, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((h, idx) => { row[h] = (values[idx] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

async function readGtfsFiles(gtfsPath) {
  const stat = fs.statSync(gtfsPath);
  if (stat.isDirectory()) {
    return {
      readFile: (name) => {
        const fp = path.join(gtfsPath, name);
        if (!fs.existsSync(fp)) return null;
        return fs.readFileSync(fp, 'utf8');
      }
    };
  }
  // ZIP file
  let AdmZip;
  try { AdmZip = require('adm-zip'); }
  catch (e) {
    console.error('For at læse ZIP-filer, installer adm-zip: npm install adm-zip');
    process.exit(1);
  }
  const zip = new AdmZip(gtfsPath);
  return {
    readFile: (name) => {
      const entry = zip.getEntry(name);
      if (!entry) return null;
      return entry.getData().toString('utf8');
    }
  };
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const gtfsArg = process.argv[2];
  if (!gtfsArg) {
    console.error('Brug: node scripts/build-gtfs-data.js <gtfs-mappe-eller-zip>');
    process.exit(1);
  }

  const gtfsPath = path.resolve(gtfsArg);
  if (!fs.existsSync(gtfsPath)) {
    console.error('Fil/mappe ikke fundet:', gtfsPath);
    process.exit(1);
  }

  const outDir = path.resolve(__dirname, '../data');
  fs.mkdirSync(outDir, { recursive: true });

  console.log('Læser GTFS fra:', gtfsPath);
  const reader = await readGtfsFiles(gtfsPath);

  // ── 1. stops.txt → data/stops.json ────────────────────────────────────────
  console.log('Behandler stops.txt ...');
  const stopsText = reader.readFile('stops.txt');
  if (!stopsText) { console.error('stops.txt ikke fundet i GTFS-data'); process.exit(1); }

  const stopsRows = parseCSV(stopsText);
  // Behold kun fysiske stop (location_type=0 eller tom) – ikke station-noder
  const stopsData = stopsRows
    .filter(r => r.stop_lat && r.stop_lon && (!r.location_type || r.location_type === '0'))
    .map(r => ({
      id:   r.stop_id,
      name: r.stop_name,
      lat:  parseFloat(r.stop_lat),
      lng:  parseFloat(r.stop_lon)
    }))
    .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng));

  const stopsOut = path.join(outDir, 'stops.json');
  fs.writeFileSync(stopsOut, JSON.stringify(stopsData));
  console.log(`  → ${stopsData.length} stops skrevet til ${stopsOut}`);

  // ── 2. trips + routes + stop_times → data/stop_routes.json ───────────────
  console.log('Behandler routes.txt ...');
  const routesText = reader.readFile('routes.txt');
  if (!routesText) { console.warn('routes.txt ikke fundet – stop_routes.json springes over'); return; }
  const routeRows = parseCSV(routesText);
  // route_id → short_name (for internal lookups)
  const routeMap = {};
  // route_id → long_name
  const routeLongMap = {};
  routeRows.forEach(r => {
    routeMap[r.route_id] = r.route_short_name || r.route_long_name || r.route_id;
    routeLongMap[r.route_id] = r.route_long_name || '';
  });

  // Gem route_id → {route_short_name, route_long_name} som array til data/routes.json
  // (Understøtter både kort og lang navn; kompatibel med loadGtfsRoutes() array-format)
  const routesJsonArray = routeRows.map(r => ({
    route_id:         r.route_id,
    route_short_name: r.route_short_name || '',
    route_long_name:  r.route_long_name  || ''
  }));
  const routesJsonFile = path.join(outDir, 'routes.json');
  fs.writeFileSync(routesJsonFile, JSON.stringify(routesJsonArray));
  console.log(`  → ${routesJsonArray.length} ruter skrevet til ${routesJsonFile}`);

  console.log('Behandler trips.txt ...');
  const tripsText = reader.readFile('trips.txt');
  if (!tripsText) { console.warn('trips.txt ikke fundet – stop_routes.json springes over'); return; }
  const tripRows = parseCSV(tripsText);
  // trip_id → {route_id, headsign}
  const tripMap = {};
  tripRows.forEach(t => {
    tripMap[t.trip_id] = { routeId: t.route_id, headsign: t.trip_headsign || '' };
  });

  // Gem trip_id → headsign til data/trips_headsign.json (bruges af frontend til retningsvisning)
  const tripsHeadsignOut = {};
  tripRows.forEach(t => { if (t.trip_headsign) tripsHeadsignOut[t.trip_id] = t.trip_headsign; });
  const tripsHeadsignFile = path.join(outDir, 'trips_headsign.json');
  fs.writeFileSync(tripsHeadsignFile, JSON.stringify(tripsHeadsignOut));
  console.log(`  → ${Object.keys(tripsHeadsignOut).length} headsigns skrevet til ${tripsHeadsignFile}`);

  // ── 2b. shapes.txt → data/shapes.json + data/trip_to_shape.json ──────────
  // shapes.json:     shape_id → [[lon, lat], ...]  (sorted by shape_pt_sequence)
  // trip_to_shape.json: trip_id → shape_id
  console.log('Behandler shapes.txt ...');
  const shapesText = reader.readFile('shapes.txt');
  if (shapesText) {
    // Build trip_id → shape_id from trips.txt (already parsed above)
    const tripToShape = {};
    tripRows.forEach(t => { if (t.trip_id && t.shape_id) tripToShape[t.trip_id] = t.shape_id; });

    // Parse shapes.txt into shape_id → [{seq, lon, lat}]
    const shapeLines = shapesText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const shapeHeaders = parseCSVLine(shapeLines[0]).map(h => h.trim().replace(/^\uFEFF/, ''));
    const colShapeId  = shapeHeaders.indexOf('shape_id');
    const colSeqS     = shapeHeaders.indexOf('shape_pt_sequence');
    const colLatS     = shapeHeaders.indexOf('shape_pt_lat');
    const colLonS     = shapeHeaders.indexOf('shape_pt_lon');
    if (colShapeId < 0 || colLatS < 0 || colLonS < 0) {
      console.warn('  shapes.txt: ukendt kolonneformat – springes over');
    } else {
      const shapePts = {}; // shape_id → [[seq, lon, lat], ...]
      for (let i = 1; i < shapeLines.length; i++) {
        const line = shapeLines[i].trim();
        if (!line) continue;
        const vals = parseCSVLine(line);
        const sid = vals[colShapeId];
        const seq = colSeqS >= 0 ? parseInt(vals[colSeqS], 10) : i;
        const lat = parseFloat(vals[colLatS]);
        const lon = parseFloat(vals[colLonS]);
        if (!sid || isNaN(lat) || isNaN(lon)) continue;
        if (!shapePts[sid]) shapePts[sid] = [];
        shapePts[sid].push([seq, lon, lat]);
      }
      // Sort each shape by sequence and output [[lon, lat], ...] with 5-decimal precision
      const shapesOut = {};
      for (const [sid, pts] of Object.entries(shapePts)) {
        pts.sort((a, b) => a[0] - b[0]);
        shapesOut[sid] = pts.map(p => [
          Math.round(p[1] * 100000) / 100000,
          Math.round(p[2] * 100000) / 100000
        ]);
      }
      const shapesFile = path.join(outDir, 'shapes.json');
      fs.writeFileSync(shapesFile, JSON.stringify(shapesOut));
      console.log(`  → ${Object.keys(shapesOut).length} shapes skrevet til ${shapesFile}`);

      const tripToShapeFile = path.join(outDir, 'trip_to_shape.json');
      fs.writeFileSync(tripToShapeFile, JSON.stringify(tripToShape));
      console.log(`  → ${Object.keys(tripToShape).length} trip→shape mappings skrevet til ${tripToShapeFile}`);
    }
  } else {
    console.warn('  shapes.txt ikke fundet – shapes.json springes over');
  }

  console.log('Behandler stop_times.txt ... (kan tage lidt tid)');
  const stopTimesText = reader.readFile('stop_times.txt');
  if (!stopTimesText) { console.warn('stop_times.txt ikke fundet – stop_routes.json springes over'); return; }

  // Byg stop_id → Set af "routeLine|headsign"
  const stopRoutesMap = {};  // stop_id → Map<line, Set<headsign>>
  // Byg 5-min afgangsvinduer: slotKey ('HH_MM', f.eks. '08_05') → stop_id → [{route_id, short_name, arrival, departure}]
  const departureSlots = {};
  // Byg route_id → Set<stop_id> til route_stops.json
  const routeStopSet = {};  // route_id → Set<stop_id>

  const lines = stopTimesText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const headers = parseCSVLine(lines[0]).map(h => h.trim().replace(/^\uFEFF/, ''));
  const colTripId    = headers.indexOf('trip_id');
  const colStopId    = headers.indexOf('stop_id');
  const colSeq       = headers.indexOf('stop_sequence');
  const colArrival   = headers.indexOf('arrival_time');
  const colDeparture = headers.indexOf('departure_time');

  if (colTripId < 0 || colStopId < 0) {
    console.error('Ukendt stop_times.txt format'); process.exit(1);
  }

  let processed = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = parseCSVLine(line);
    const tripId = vals[colTripId];
    const stopId = vals[colStopId];
    if (!tripId || !stopId) continue;

    const trip = tripMap[tripId];
    if (!trip) continue;
    const lineName = routeMap[trip.routeId];
    if (!lineName) continue;

    const seq = colSeq >= 0 ? vals[colSeq] : '';

    // ── stop_routes.json: registrér kun første stop per tur (seq=1) ──
    if (seq === '1' || seq === '') {
      if (!stopRoutesMap[stopId]) stopRoutesMap[stopId] = {};
      if (!stopRoutesMap[stopId][lineName]) stopRoutesMap[stopId][lineName] = new Set();
      if (trip.headsign) stopRoutesMap[stopId][lineName].add(trip.headsign);
    }

    // ── route_stops.json: registrér alle stop per rute ──
    if (!routeStopSet[trip.routeId]) routeStopSet[trip.routeId] = new Set();
    routeStopSet[trip.routeId].add(stopId);

    // ── departures_5min/: registrér alle afgange med short_name ──
    const depTime = colDeparture >= 0 ? (vals[colDeparture] || '').trim() : '';
    const arrTime = colArrival  >= 0 ? (vals[colArrival]  || '').trim() : '';
    const timeStr = depTime || arrTime;
    if (timeStr) {
      // Parse "HH:MM:SS" – GTFS tillader H > 23 for afgange efter midnat
      const parts = timeStr.split(':');
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1] || '0', 10);
      if (!isNaN(h) && !isNaN(m)) {
        const slotMin = Math.floor(m / 5) * 5;
        const slotKey = String(h).padStart(2, '0') + '_' + String(slotMin).padStart(2, '0');
        if (!departureSlots[slotKey]) departureSlots[slotKey] = {};
        if (!departureSlots[slotKey][stopId]) departureSlots[slotKey][stopId] = [];
        const entry = {
          route_id:   trip.routeId,
          short_name: lineName,
          arrival:    arrTime,
          departure:  depTime
        };
        if (trip.headsign) entry.headsign = trip.headsign;
        departureSlots[slotKey][stopId].push(entry);
      }
    }

    processed++;
    if (processed % 500000 === 0) console.log(`  ${processed} linjer behandlet...`);
  }

  // Serialisér: stop_id → [{line, headsigns:[...]}]
  const stopRoutesOut = {};
  for (const [stopId, lineMap] of Object.entries(stopRoutesMap)) {
    stopRoutesOut[stopId] = Object.entries(lineMap).map(([line, heads]) => ({
      line,
      headsigns: [...heads].sort()
    }));
  }

  const stopRoutesFile = path.join(outDir, 'stop_routes.json');
  fs.writeFileSync(stopRoutesFile, JSON.stringify(stopRoutesOut));
  console.log(`  → ${Object.keys(stopRoutesOut).length} stop-ruter skrevet til ${stopRoutesFile}`);

  // ── 3. Skriv route_stops.json ─────────────────────────────────────────────
  const routeStopsOut = {};
  for (const [routeId, stops] of Object.entries(routeStopSet)) {
    routeStopsOut[routeId] = [...stops];
  }
  const routeStopsFile = path.join(outDir, 'route_stops.json');
  fs.writeFileSync(routeStopsFile, JSON.stringify(routeStopsOut));
  console.log(`  → ${Object.keys(routeStopsOut).length} ruter skrevet til ${routeStopsFile}`);

  // ── 4. Skriv departures_5min/*.json ─────────────────────────────────────
  const depOutDir = path.join(outDir, 'departures_5min');
  fs.mkdirSync(depOutDir, { recursive: true });
  let slotCount = 0;
  for (const [slotKey, stopMap] of Object.entries(departureSlots)) {
    // Sortér afgange inden for hvert stop kronologisk og behold maks 20 per stop
    const slotOut = {};
    for (const [stopId, deps] of Object.entries(stopMap)) {
      deps.sort((a, b) => (a.departure || a.arrival || '').localeCompare(b.departure || b.arrival || ''));
      slotOut[stopId] = deps.slice(0, 20);
    }
    fs.writeFileSync(path.join(depOutDir, slotKey + '.json'), JSON.stringify(slotOut));
    slotCount++;
  }
  console.log(`  → ${slotCount} afgangsvinduer skrevet til ${depOutDir}/`);
  console.log('Færdig!');
}

main().catch(e => { console.error(e); process.exit(1); });
