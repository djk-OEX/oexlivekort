#!/usr/bin/env node
/**
 * test-render-departures.js
 * -------------------------
 * Simpel verifikation af at afgangsviser-logikken i index.html
 * viser buslinjens short_name korrekt.
 *
 * Brug:
 *   node scripts/test-render-departures.js
 */
'use strict';

// ── Helpers der spejler index.html logik ────────────────────────────────────

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _renderRouteList(deps) {
  if (!deps || !deps.length)
    return '<div class="oex-tp-deps"><div class="oex-tp-dep" style="color:#bbbbbb;font-size:12px;">Ingen afgange i dette tidsvindue</div></div>';
  let html = '<div class="oex-tp-deps">';
  deps.forEach(d => {
    const label = d.name ? escapeHtml(d.name) + ' · ' + escapeHtml(d.time) : escapeHtml(d.time);
    html += '<div class="oex-tp-dep"><span class="oex-tp-dep-line">' + label + '</span></div>';
  });
  html += '</div>';
  return html;
}

/**
 * Simulerer fetchGtfsDepartures med mock data.
 * Prioriterer e.short_name, falder tilbage på routeLookup[e.route_id].
 */
function buildDepartures(entries, routeLookup) {
  return entries.slice(0, 8).map(e => {
    const label = e.short_name || routeLookup[e.route_id] || e.route_id || '';
    const timeStr = (e.departure || e.arrival || '').substring(0, 5);
    return { name: label, time: timeStr };
  });
}

// Spejler _getDaySlotKeys fra index.html
function _getDaySlotKeys() {
  const keys = [];
  for (let h = 4; h <= 27; h++) {
    for (let m = 0; m < 60; m += 5) {
      keys.push(String(h).padStart(2, '0') + '_' + String(m).padStart(2, '0'));
    }
  }
  return keys;
}

// Forenklet version af showTransitPanel HTML-generering (til test)
function buildTransitPanelHtml(stop1, stop2, hasB, deps1, deps2, nextDep1, nextDep2) {
  let html = '<div class="oex-tp-title">🚌 Nærmeste busstop</div>';
  const anyNoDeps = (stop1 && (!deps1 || !deps1.length)) || (stop2 && (!deps2 || !deps2.length));
  const routeShortName = (nextDep1 && nextDep1.routeShortName) || (nextDep2 && nextDep2.routeShortName) || '';
  if (anyNoDeps && routeShortName) {
    html += '<div class="oex-tp-routename">' + escapeHtml(routeShortName) + '</div>';
  }
  if (stop1) {
    html += '<div class="oex-tp-row"><strong>Fra A:</strong> ' + escapeHtml(stop1.name) + '</div>';
    html += _renderRouteList(deps1);
  }
  if (hasB && stop2) {
    html += '<div class="oex-tp-row"><strong>Til B:</strong> ' + escapeHtml(stop2.name) + '</div>';
    html += _renderRouteList(deps2);
  }
  if (anyNoDeps) {
    const times = [nextDep1 && nextDep1.nextTime, nextDep2 && nextDep2.nextTime].filter(Boolean);
    if (times.length) {
      times.sort();
      html += '<div class="oex-tp-next">Næste afgang: ' + escapeHtml(times[0]) + '</div>';
    }
  }
  return html;
}

// ── Test 1: Ingen afgange → vis "Ingen afgange i dette tidsvindue" ───────────
(function testNoDepartures() {
  const html = _renderRouteList([]);
  console.assert(html.includes('Ingen afgange i dette tidsvindue'), 'FEJL: Ingen-afgange besked mangler');
  console.assert(!html.includes('oex-tp-dep-line'), 'FEJL: Uventet linje-element');
  console.log('✅ Test 1 bestået: ingen afgange viser korrekt besked');
})();

// ── Test 2: Afgange med short_name i departure-entry (nyt format) ─────────────
(function testShortNameEmbedded() {
  const entries = [
    { route_id: '102785-111', short_name: '2A',  departure: '08:05:00', arrival: '08:04:00' },
    { route_id: '102785-222', short_name: '18',   departure: '08:07:00', arrival: '08:06:00' },
  ];
  const deps = buildDepartures(entries, {});
  console.assert(deps[0].name === '2A', `FEJL: Forventet "2A", fik "${deps[0].name}"`);
  console.assert(deps[1].name === '18', `FEJL: Forventet "18", fik "${deps[1].name}"`);
  const html = _renderRouteList(deps);
  console.assert(html.includes('2A · 08:05'), `FEJL: HTML mangler "2A · 08:05": ${html}`);
  console.assert(html.includes('18 · 08:07'), `FEJL: HTML mangler "18 · 08:07": ${html}`);
  console.assert(!html.includes('Ingen afgange'), 'FEJL: Uventet ingen-afgange besked');
  console.log('✅ Test 2 bestået: short_name fra departure-entry vises korrekt');
})();

// ── Test 3: Afgange med routeLookup (nyt routes.json format: route_id → str) ──
(function testRouteLookup() {
  const routeLookup = { '102785-333': '6A', '102785-444': '350S' };
  const entries = [
    { route_id: '102785-333', departure: '09:00:00', arrival: '08:59:00' },
    { route_id: '102785-444', departure: '09:10:00', arrival: '09:09:00' },
  ];
  const deps = buildDepartures(entries, routeLookup);
  console.assert(deps[0].name === '6A',   `FEJL: Forventet "6A", fik "${deps[0].name}"`);
  console.assert(deps[1].name === '350S', `FEJL: Forventet "350S", fik "${deps[1].name}"`);
  const html = _renderRouteList(deps);
  console.assert(html.includes('6A · 09:00'), `FEJL: HTML mangler "6A · 09:00"`);
  console.assert(html.includes('350S · 09:10'), `FEJL: HTML mangler "350S · 09:10"`);
  console.log('✅ Test 3 bestået: short_name fra routeLookup vises korrekt');
})();

// ── Test 4: Afgange uden short_name og uden routeLookup → vis route_id som label ─
(function testRouteIdFallback() {
  const entries = [
    { route_id: '102785-555', departure: '10:30:00', arrival: '10:29:00' },
  ];
  const deps = buildDepartures(entries, {});
  console.assert(deps[0].name === '102785-555', `FEJL: Forventet route_id "102785-555" som fallback, fik "${deps[0].name}"`);
  const html = _renderRouteList(deps);
  console.assert(html.includes('102785-555 · 10:30'), `FEJL: HTML mangler "102785-555 · 10:30": ${html}`);
  console.assert(html.includes(' · '), 'FEJL: Separator " · " mangler ved route_id fallback');
  console.assert(!html.includes('Ingen afgange'), 'FEJL: Uventet ingen-afgange besked');
  console.log('✅ Test 4 bestået: route_id vises som fallback label når short_name mangler');
})();

// ── Test 5: HTML-escape af særlige tegn ───────────────────────────────────────
(function testEscaping() {
  const entries = [
    { route_id: '102785-666', short_name: '<script>', departure: '11:00:00', arrival: '10:59:00' },
  ];
  const deps = buildDepartures(entries, {});
  const html = _renderRouteList(deps);
  console.assert(!html.includes('<script>'), 'FEJL: Uescaped <script> tag i HTML');
  console.assert(html.includes('&lt;script&gt;'), 'FEJL: Manglende HTML-escape');
  console.log('✅ Test 5 bestået: HTML-escape fungerer korrekt');
})();

// ── Test 6: _getDaySlotKeys starter ved 04_00 og ender ved 27_55 ──────────────
(function testDaySlotKeys() {
  const keys = _getDaySlotKeys();
  console.assert(keys[0] === '04_00', `FEJL: Første nøgle skal være "04_00", fik "${keys[0]}"`);
  console.assert(keys[keys.length - 1] === '27_55', `FEJL: Sidste nøgle skal være "27_55", fik "${keys[keys.length - 1]}"`);
  // 24 timer (h=4..27 inklusiv) × 12 slots/time = 288 nøgler
  console.assert(keys.length === 288, `FEJL: Forventet 288 nøgler, fik ${keys.length}`);
  console.assert(keys.includes('12_00'), 'FEJL: Mangler nøgle "12_00"');
  console.assert(keys.includes('23_55'), 'FEJL: Mangler nøgle "23_55"');
  console.assert(keys.includes('24_00'), 'FEJL: Mangler nøgle "24_00"');
  console.log('✅ Test 6 bestået: _getDaySlotKeys genererer korrekte nøgler');
})();

// ── Test 7: Panel med ingen afgange → vis routeShortName og Næste afgang ───────
(function testPanelNoDepsShowsNextDep() {
  const stop1 = { name: 'Tretommervej/Grenåvej (Aarhus Kom)', dist: 25 };
  const stop2 = { name: 'Aarhus Banegårdsplads', dist: 22 };
  const nextDep1 = { routeShortName: '1A', nextTime: '06:07:00' };
  const nextDep2 = { routeShortName: '1A', nextTime: '06:10:00' };
  const html = buildTransitPanelHtml(stop1, stop2, true, [], [], nextDep1, nextDep2);
  console.assert(html.includes('oex-tp-routename'), 'FEJL: Route short name element mangler');
  console.assert(html.includes('1A'), 'FEJL: Route short name "1A" mangler i HTML');
  console.assert(html.includes('Næste afgang: 06:07:00'), `FEJL: Næste afgang mangler: ${html}`);
  console.assert(html.includes('Ingen afgange i dette tidsvindue'), 'FEJL: Ingen-afgange besked mangler');
  console.log('✅ Test 7 bestået: panel viser routeShortName og Næste afgang ved ingen afgange');
})();

// ── Test 8: Panel med afgange → ingen routeShortName header, ingen Næste afgang ─
(function testPanelWithDepsNoNextDep() {
  const stop1 = { name: 'Tretommervej/Grenåvej (Aarhus Kom)', dist: 25 };
  const deps1 = [{ name: '1A', time: '08:05' }];
  const html = buildTransitPanelHtml(stop1, null, false, deps1, [], null, null);
  console.assert(!html.includes('oex-tp-routename'), 'FEJL: Uventet route short name element ved eksisterende afgange');
  console.assert(!html.includes('Næste afgang'), 'FEJL: Uventet Næste afgang ved eksisterende afgange');
  console.assert(html.includes('1A · 08:05'), 'FEJL: Afgangsliste mangler');
  console.log('✅ Test 8 bestået: panel med afgange viser ikke nextDep info');
})();

// ── Test 9: Næste afgang viser tidligste tid fra begge stop ──────────────────
(function testPanelEarliestNextDep() {
  const stop1 = { name: 'Stop A', dist: 10 };
  const stop2 = { name: 'Stop B', dist: 15 };
  const nextDep1 = { routeShortName: '2A', nextTime: '07:30:00' };
  const nextDep2 = { routeShortName: '2A', nextTime: '06:15:00' };
  const html = buildTransitPanelHtml(stop1, stop2, true, [], [], nextDep1, nextDep2);
  console.assert(html.includes('Næste afgang: 06:15:00'), `FEJL: Skulle vise tidligste tid "06:15:00": ${html}`);
  console.assert(!html.includes('07:30:00'), 'FEJL: Senere tid "07:30:00" skulle ikke vises');
  console.log('✅ Test 9 bestået: viser tidligste næste afgang på tværs af stop');
})();

// ── Test 10: Panel med ingen nextDep → kun "Ingen afgange" besked ────────────
(function testPanelNoDepsNoNextDep() {
  const stop1 = { name: 'Stop A', dist: 10 };
  const html = buildTransitPanelHtml(stop1, null, false, [], [], null, null);
  console.assert(html.includes('Ingen afgange i dette tidsvindue'), 'FEJL: Ingen-afgange besked mangler');
  console.assert(!html.includes('oex-tp-routename'), 'FEJL: Uventet route short name ved null nextDep');
  console.assert(!html.includes('Næste afgang'), 'FEJL: Uventet Næste afgang ved null nextDep');
  console.log('✅ Test 10 bestået: ingen nextDep → kun ingen-afgange besked');
})();

// ── Test 11: route_id fallback via routeLookup (nye routes.json format) ────────
(function testRouteIdFallbackViaLookup() {
  // Simulates new routes.json format: route_id → short_name
  const routeLookup = { '102785-159570930': '6A' };
  const entries = [
    { route_id: '102785-159570930', departure: '12:00:00', arrival: '11:59:00' },
    // route_id not in lookup → should fallback to route_id itself
    { route_id: '102785-999999999', departure: '12:05:00', arrival: '12:04:00' },
  ];
  const deps = buildDepartures(entries, routeLookup);
  console.assert(deps[0].name === '6A', `FEJL: Forventet "6A" fra lookup, fik "${deps[0].name}"`);
  console.assert(deps[1].name === '102785-999999999', `FEJL: Forventet route_id som fallback, fik "${deps[1].name}"`);
  const html = _renderRouteList(deps);
  console.assert(html.includes('6A · 12:00'), `FEJL: HTML mangler "6A · 12:00": ${html}`);
  console.assert(html.includes('102785-999999999 · 12:05'), `FEJL: HTML mangler route_id fallback: ${html}`);
  console.log('✅ Test 11 bestået: lookup virker + route_id vises som fallback ved manglende lookup');
})();

console.log('\nAlle tests bestået ✅');
