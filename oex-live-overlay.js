// ============================================================
// OEX LIVE POSITIONS OVERLAY
// Additive, non-breaking overlay for the existing atlas.Map.
// All logic is self-contained in initOexLiveOverlay(map).
// To remove: delete this file and the two lines that reference
// it in index.html (script tag + initOexLiveOverlay call).
// ============================================================

/**
 * Initialises the live OEX positions overlay on the given atlas.Map instance.
 * Creates one DataSource and one SymbolLayer dedicated to live markers.
 * Refreshes positions every 60 seconds from /api/oex/positions.
 *
 * @param {atlas.Map} map - The existing Azure Maps instance.
 */
function initOexLiveOverlay(map) {
  // --- DataSource for live OEX positions (separate from existing sources) ---
  const oexLiveDataSource = new atlas.source.DataSource();
  map.sources.add(oexLiveDataSource);

  // --- SymbolLayer: marker icon + user-name label ---
  // Added without a 'before' id so it appears on top of existing layers.
  const oexLiveLayer = new atlas.layer.SymbolLayer(oexLiveDataSource, 'oex-live-layer', {
    iconOptions: {
      // Use the built-in pin icon; tint it with OEX blue.
      image: 'pin-round-blue',
      size: 1,
      allowOverlap: true,
      ignorePlacement: true
    },
    textOptions: {
      // Display the 'user' property as the label.
      textField: ['get', 'user'],
      color: '#ffffff',
      haloColor: '#000000',
      haloWidth: 1.5,
      offset: [0, -2.2],
      size: 13,
      allowOverlap: true,
      ignorePlacement: true
    }
  });
  map.layers.add(oexLiveLayer);

  // --- Fetch and repopulate live positions ---
  async function refreshLivePositions() {
    try {
      const res = await fetch('/api/oex/positions');
      if (!res.ok) {
        console.warn('[OEX Live] /api/oex/positions returned HTTP', res.status);
        return;
      }
      const data = await res.json();
      if (!Array.isArray(data)) {
        console.warn('[OEX Live] Unexpected response format (expected array):', data);
        return;
      }

      // Clear existing live markers before repopulating.
      oexLiveDataSource.clear();

      const features = data
        .filter(entry => {
          const lat = Number(entry.lat);
          const lon = Number(entry.lon);
          return (
            typeof entry.user === 'string' &&
            entry.user.length > 0 &&
            Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
            Number.isFinite(lon) && lon >= -180 && lon <= 180
          );
        })
        .map(entry => new atlas.data.Feature(
          new atlas.data.Point([Number(entry.lon), Number(entry.lat)]),
          { user: entry.user, lastSeen: entry.lastSeen || null }
        ));

      if (features.length > 0) {
        oexLiveDataSource.add(features);
      }
    } catch (err) {
      console.warn('[OEX Live] Failed to refresh positions:', err);
    }
  }

  // Fetch immediately, then every 60 seconds.
  refreshLivePositions();
  const oexLiveIntervalId = setInterval(refreshLivePositions, 60_000);

  // Return cleanup function in case the overlay needs to be removed later.
  return function destroyOexLiveOverlay() {
    clearInterval(oexLiveIntervalId);
    map.layers.remove('oex-live-layer');
    map.sources.remove(oexLiveDataSource);
  };
}
