// ============================================================
// OEX LIVE POSITIONS OVERLAY
// Additive, non-breaking overlay for the existing atlas.Map.
// All logic is self-contained in initOexLiveOverlay(map, opts).
// To remove: delete this file and the two lines that reference
// it in index.html (script tag + initOexLiveOverlay call).
// ============================================================

/**
 * Initialises the live OEX positions overlay on the given atlas.Map instance.
 * Creates one DataSource and one SymbolLayer dedicated to live markers.
 * Refreshes positions every 60 seconds from /api/oex/positions.
 *
 * @param {atlas.Map} map - The existing Azure Maps instance.
 * @param {object}   [opts]
 * @param {function} [opts.onStatus] - Called with ('ok', count) on success or
 *                                     ('error', httpStatusOrReason) on failure.
 */
function initOexLiveOverlay(map, opts) {
  const onStatus = (opts && typeof opts.onStatus === 'function') ? opts.onStatus : null;

  // --- DataSource for live OEX positions (separate from existing sources) ---
  const oexLiveDataSource = new atlas.source.DataSource();
  map.sources.add(oexLiveDataSource);

  // --- SymbolLayer: marker icon + user-name label ---
  // Added without a 'before' id so it appears on top of existing layers.
  const oexLiveLayer = new atlas.layer.SymbolLayer(oexLiveDataSource, 'oex-live-layer', {
    iconOptions: {
      // Use a guaranteed built-in Azure Maps icon to avoid engine errors
      // caused by missing icon sprites (pin-round-blue is not a built-in icon).
      image: 'marker-blue',
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

  // Visibility state — starts hidden; user must press the toggle to activate.
  let _visible = false;
  oexLiveLayer.setOptions({ visible: false });
  let oexLiveIntervalId = null;

  // --- Fetch and repopulate live positions ---
  // Returns true on success, false on any error.
  async function refreshLivePositions() {
    try {
      const res = await fetch('/api/oex/positions');
      if (!res.ok) {
        console.warn('[OEX Live] /api/oex/positions returned HTTP', res.status);
        if (onStatus) onStatus('error', res.status);
        return false;
      }
      const data = await res.json();

      if (!Array.isArray(data)) {
        console.warn('[OEX Live] Unexpected response format (expected array):', data);
        if (onStatus) onStatus('error', 'bad_response');
        return false;
      }

      // Guard: return early if the API response is empty to prevent symbol
      // layout from running against an empty state (avoids engine null errors).
      if (data.length === 0) {
        console.log('[OEX Live] No positions yet');
        oexLiveDataSource.clear();
        if (onStatus) onStatus('ok', 0);
        return true;
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

      if (onStatus) onStatus('ok', features.length);
      return true;
    } catch (err) {
      console.warn('[OEX Live] Failed to refresh positions:', err);
      if (onStatus) onStatus('error', 'network');
      return false;
    }
  }

  function setVisible(on) {
    _visible = !!on;
    if (!_visible) {
      // Hide immediately and stop polling.
      oexLiveLayer.setOptions({ visible: false });
      clearInterval(oexLiveIntervalId);
      oexLiveIntervalId = null;
      oexLiveDataSource.clear();
      return;
    }

    // Turning on: fetch first, then reveal the layer only on success.
    // This prevents showing an empty/broken layer when the API is down.
    if (!oexLiveIntervalId) {
      refreshLivePositions().then(ok => {
        if (ok && _visible) {
          oexLiveLayer.setOptions({ visible: true });
        }
      });
      oexLiveIntervalId = setInterval(refreshLivePositions, 60_000);
    }
  }

  function destroy() {
    clearInterval(oexLiveIntervalId);
    oexLiveIntervalId = null;
    map.layers.remove('oex-live-layer');
    map.sources.remove(oexLiveDataSource);
  }

  return { setVisible, destroy };
}

// --- Debug helper: callable from the browser console ---
// Usage: debugFetchOexPositions()
window.debugFetchOexPositions = async function () {
  const res = await fetch('/api/oex/positions');
  const text = await res.text();

  console.log('STATUS:', res.status);
  console.log('RAW RESPONSE:', text);

  try {
    if (text) {
      return JSON.parse(text);
    }
    return [];
  } catch (e) {
    console.error('JSON parse failed', e);
    return null;
  }
};
