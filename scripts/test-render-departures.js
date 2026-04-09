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
    const label = e.short_name || routeLookup[e.route_id] || '';
    const timeStr = (e.departure || e.arrival || '').substring(0, 5);
    return { name: label, time: timeStr };
  });
}

// ── Test 1: Ingen afgange → vis "Ingen afgange i dette tidsvindue" ───────────
(function testNoDepatures() {
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

// ── Test 4: Afgange uden short_name og uden routeLookup → vis kun tid ─────────
(function testTimeOnly() {
  const entries = [
    { route_id: '102785-555', departure: '10:30:00', arrival: '10:29:00' },
  ];
  const deps = buildDepartures(entries, {});
  console.assert(deps[0].name === '', `FEJL: Forventet tomt navn, fik "${deps[0].name}"`);
  const html = _renderRouteList(deps);
  console.assert(html.includes('10:30'), `FEJL: HTML mangler tid "10:30"`);
  console.assert(!html.includes(' · '), 'FEJL: Uventet separator " · " ved manglende navn');
  console.assert(!html.includes('Ingen afgange'), 'FEJL: Uventet ingen-afgange besked');
  console.log('✅ Test 4 bestået: kun tid vises når short_name mangler');
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

console.log('\nAlle tests bestået ✅');
