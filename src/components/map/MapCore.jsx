import React, { useEffect, useMemo, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Tooltip,
  Circle,
  Polyline,
  useMap,
} from 'react-leaflet';

import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { C } from '@/lib/designTokens';

// Leaflet's default-icon URL detection breaks under Vite. The same shim
// existed inline in FindGarage.jsx; centralised here so every consumer
// of MapCore inherits it without re-running.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// Pulsing blue dot for the user's own position. Two rings staggered
// 1.2s apart so there's always one mid-expansion — the dot reads as
// "live, breathing" instead of "tick-tick-tick". Mirrors Apple Maps'
// current-location dot + Waze. The dot itself is 18×18 with a 3px
// white ring so it remains identifiable when sitting on a colored
// road tile; shadow gives it depth above the map.
const userIcon = new L.DivIcon({
  className: '',
  html: `<div style="position:relative;width:18px;height:18px;">
    <div style="position:absolute;inset:0;border-radius:50%;background:rgba(59,130,246,0.35);animation:cr-user-pulse 2400ms cubic-bezier(0.4,0,0.6,1) infinite;"></div>
    <div style="position:absolute;inset:0;border-radius:50%;background:rgba(59,130,246,0.35);animation:cr-user-pulse 2400ms cubic-bezier(0.4,0,0.6,1) infinite;animation-delay:1200ms;"></div>
    <div style="position:absolute;inset:0;width:18px;height:18px;border-radius:50%;background:${C.info};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.35);"></div>
  </div><style>@keyframes cr-user-pulse{0%{transform:scale(1);opacity:0.6}100%{transform:scale(2.6);opacity:0}}@keyframes pulse-ring{0%{transform:scale(1);opacity:1}100%{transform:scale(2.2);opacity:0}}</style>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

// Build a DivIcon for a marker. Two shapes:
//   • `teardrop` (FindGarage default — branded pin-on-map look) — a
//     colored circle anchored to a downward-pointing triangle, like
//     the iOS/Waze convention. Anchor sits at the triangle tip so
//     the marker visually "stands on" the coordinate.
//   • `circle` (route/fleet maps — driver context where the marker
//     IS the stop, not a pin pointing AT it) — solid colored dot,
//     anchored at center, optional numbered label inside.
// `highlight: true` paints an extra pulsing outer ring + grows the
// icon — used by route maps to flag the stop the driver should hit next.
function buildMarkerIcon({ color = C.primary, number, iconSvg, highlight = false, size = 38, shape = 'circle' }) {
  const finalSize = highlight ? size + 8 : size;
  const halfShadow = `${color}60`;
  let inner = '';
  if (number != null && number !== '') {
    const numStr = String(number);
    const fontSize = numStr.length >= 3 ? 11 : numStr.length === 2 ? 13 : 15;
    inner = `<div style="font-weight:800;font-size:${fontSize + (highlight ? 1 : 0)}px;color:#fff;line-height:1;">${numStr}</div>`;
  } else if (iconSvg) {
    inner = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconSvg}</svg>`;
  }

  // ── Teardrop (FindGarage) ────────────────────────────────────
  // Circle on top + downward triangle = the "I'm pointing at this
  // spot" pin convention every consumer map uses (Google Maps,
  // Apple Maps, Waze). Anchor is at the bottom-center tip so the
  // marker rests visually on the lat/lng coordinate. Triangle
  // dimensions (6/6/12 px borders) match the circle's radius so
  // the silhouette reads as one tear shape.
  if (shape === 'teardrop') {
    const circleSize = finalSize;
    const tailHeight = 12;
    const totalHeight = circleSize + tailHeight - 4; // 4px overlap for seamless join
    return new L.DivIcon({
      className: '',
      html: `<div style="position:relative;width:${circleSize}px;height:${totalHeight}px;">
        <div style="
          position:absolute;top:0;left:0;width:${circleSize}px;height:${circleSize}px;
          border-radius:50%;background:${color};border:2.5px solid #fff;
          box-shadow:0 4px 12px ${halfShadow};
          display:flex;align-items:center;justify-content:center;
        ">${inner}</div>
        <div style="
          position:absolute;bottom:0;left:50%;transform:translateX(-50%);
          width:0;height:0;
          border-left:7px solid transparent;border-right:7px solid transparent;
          border-top:${tailHeight}px solid ${color};
          filter:drop-shadow(0 2px 3px ${halfShadow});
        "></div>
      </div>`,
      iconSize: [circleSize, totalHeight],
      iconAnchor: [circleSize / 2, totalHeight],  // tip of the tail
      popupAnchor: [0, -totalHeight + 6],
    });
  }

  // ── Circle (route / fleet) ────────────────────────────────────
  const ring = highlight
    ? `<div style="position:absolute;inset:-5px;border-radius:50%;border:2px solid ${color};opacity:0.45;animation:pulse-ring 2s ease-out infinite;"></div>`
    : '';
  const wrapper = highlight
    ? `<div style="position:relative;width:${finalSize}px;height:${finalSize}px;">`
    : '';
  const wrapperClose = highlight ? '</div>' : '';
  return new L.DivIcon({
    className: '',
    html: `${wrapper}${ring}<div style="width:${finalSize}px;height:${finalSize}px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 10px ${halfShadow};display:flex;align-items:center;justify-content:center;${highlight ? 'position:relative;' : ''}">${inner}</div>${wrapperClose}`,
    iconSize: [finalSize, finalSize],
    iconAnchor: [finalSize / 2, finalSize / 2],
    popupAnchor: [0, -(finalSize / 2 + 3)],
  });
}

// Internal: imperatively recenter the map when `center` or `zoom` change.
function Recenter({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView(center, zoom);
    // Use scalar deps so an array-identity change doesn't re-fire setView.
  }, [center?.[0], center?.[1], zoom, map]);
  return null;
}

// Internal: fit the viewport to the markers (and route points) the first
// time they appear / change. Skipped silently when there's nothing to fit.
function FitBounds({ markers, routes, fitToMarkers }) {
  const map = useMap();
  useEffect(() => {
    if (!fitToMarkers) return;
    const points = [];
    for (const m of markers || []) {
      if (m && Number.isFinite(m.lat) && Number.isFinite(m.lng)) points.push([m.lat, m.lng]);
    }
    for (const r of routes || []) {
      for (const p of r?.points || []) {
        if (p && Number.isFinite(p.lat) && Number.isFinite(p.lng)) points.push([p.lat, p.lng]);
      }
    }
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
      return;
    }
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }, [markers, routes, fitToMarkers, map]);
  return null;
}

/**
 * Reusable Leaflet/OpenStreetMap surface for the project.
 *
 * Drives three feature areas with one component:
 *   1. "מצא מוסך" — typed colored markers + radius circle + user dot.
 *   2. Route detail map — numbered stops connected by a polyline.
 *   3. Driver / Fleet maps — many markers + several colored polylines.
 *
 * Marker shape: { id, lat, lng, color?, number?, iconSvg?, ...passthrough }
 * Route shape:  { id, color, points: [{lat,lng}, ...], dashed? }
 *
 * Anything passed on a marker beyond the recognised keys is preserved on
 * the object so renderTooltip / renderPopup / onMarkerClick callbacks can
 * read it without an extra lookup.
 */
export default function MapCore({
  markers = [],
  routes = [],
  center,
  zoom = 13,
  userLocation = null,
  showUserLocation = false,
  fitToMarkers = false,
  onMarkerClick,
  renderPopup,
  renderTooltip,
  mapHeight = '35vh',
  mapMinHeight = '200px',
  mapMaxHeight = '500px',
  emptyStateMessage = 'אין מיקום להצגה',
  showCircle = false,
  circleColor = C.primary,
  circleRadius = 5000,
  scrollWheelZoom = true,
  tooltipClassName = '',
  className = '',
  mapRef: externalMapRef,
  children,
  // When true the wrapper drops its rounded corners + shadow + border
  // so a `fixed inset-0` parent can use the map edge-to-edge. The
  // outer container still owns the height — pass `mapHeight: '100%'`
  // alongside `fullscreen` so MapCore fills the flex parent rather
  // than capping at a vh value (100vh is buggy under Capacitor iOS,
  // doesn't account for status bar / home indicator).
  fullscreen = false,
}) {
  const internalMapRef = useRef(null);
  const mapRef = externalMapRef || internalMapRef;

  // Cache icons per (color, number, iconSvg, highlight) so panning a
  // 50-marker map doesn't allocate 50 new DivIcons on every render.
  const iconsByKey = useMemo(() => {
    const cache = new Map();
    for (const m of markers) {
      const key = `${m.color || C.primary}|${m.number ?? ''}|${m.iconSvg || ''}|${m.highlight ? '1' : '0'}|${m.shape || 'circle'}`;
      if (!cache.has(key)) {
        cache.set(
          key,
          buildMarkerIcon({ color: m.color, number: m.number, iconSvg: m.iconSvg, highlight: !!m.highlight, shape: m.shape || 'circle' })
        );
      }
    }
    return cache;
  }, [markers]);

  // Effective center resolution order:
  //   1. Explicit `center` prop (caller knows best).
  //   2. User location (FindGarage style — map follows the user).
  //   3. First valid marker — used by route maps that pass `markers` only
  //      and rely on `fitToMarkers` to zoom in. Without this fallback the
  //      map would render the "no location" empty state even though
  //      there ARE plottable points.
  const effectiveCenter = (() => {
    if (center) return center;
    if (userLocation && Number.isFinite(userLocation.lat) && Number.isFinite(userLocation.lng)) {
      return [userLocation.lat, userLocation.lng];
    }
    const firstWithCoords = (markers || []).find(
      (m) => Number.isFinite(m?.lat) && Number.isFinite(m?.lng)
    );
    if (firstWithCoords) return [firstWithCoords.lat, firstWithCoords.lng];
    const firstRoutePoint = (routes || [])
      .flatMap((r) => r?.points || [])
      .find((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng));
    if (firstRoutePoint) return [firstRoutePoint.lat, firstRoutePoint.lng];
    return null;
  })();

  // Empty state — no center, no markers, no routes. Genuinely nothing to draw.
  if (!effectiveCenter) {
    return (
      <div
        className={`rounded-2xl flex items-center justify-center ${className}`}
        style={{
          height: mapHeight,
          minHeight: mapMinHeight,
          maxHeight: mapMaxHeight,
          background: C.gray50,
          border: `1.5px solid ${C.gray200}`,
        }}
        dir="rtl"
      >
        <p className="text-sm text-gray-500">{emptyStateMessage}</p>
      </div>
    );
  }

  return (
    <div
      className={`${fullscreen ? 'overflow-hidden' : 'rounded-2xl overflow-hidden shadow-md border'} ${className}`}
      style={{
        height: mapHeight,
        minHeight: mapMinHeight,
        maxHeight: mapMaxHeight,
        position: 'relative',
        zIndex: 1,
        // Drop the rounded corner border-color when fullscreen so the
        // map paint reaches the actual viewport edges — without this,
        // Leaflet was clipping inside the rounded mask which made the
        // map look like it occupied "only half the screen" even though
        // the wrapper was fixed inset-0.
        ...(fullscreen ? {} : { borderColor: C.gray200 }),
      }}
    >
      <MapContainer
        center={effectiveCenter}
        zoom={zoom}
        scrollWheelZoom={scrollWheelZoom}
        style={{ height: '100%', width: '100%' }}
        ref={mapRef}
      >
        {/* CartoDB Voyager — a designed OSM derivative with a cleaner
            palette than raw OpenStreetMap (less yellow noise, softer
            green for parks, muted roads). Same tile pyramid + same
            attribution requirement. Free for non-commercial use of
            our scale; if usage grows we move to a paid Mapbox plan
            with a custom CarReminder style. The visual lift here is
            "designed product" vs "default leaflet" — single biggest
            map-page improvement we can ship without restructuring. */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={20}
        />

        {/* Recenter when caller-supplied center prop changes */}
        {center && <Recenter center={center} zoom={zoom} />}

        {/* Optional fit-to-content */}
        <FitBounds markers={markers} routes={routes} fitToMarkers={fitToMarkers} />

        {/* Optional radius circle around the user (used by FindGarage) */}
        {showCircle && userLocation && (
          <Circle
            center={[userLocation.lat, userLocation.lng]}
            radius={circleRadius}
            pathOptions={{
              color: circleColor,
              fillColor: circleColor,
              fillOpacity: 0.08,
              weight: 1.5,
              dashArray: '6 4',
            }}
          />
        )}

        {/* User-location marker */}
        {showUserLocation && userLocation && (
          <Marker position={[userLocation.lat, userLocation.lng]} icon={userIcon}>
            <Popup>
              <div className="text-center text-sm font-medium" dir="rtl">
                המיקום שלך
              </div>
            </Popup>
          </Marker>
        )}

        {/* Route polylines (per-task / per-driver coloring done by caller) */}
        {routes.map((r) =>
          r?.points && r.points.length >= 2 ? (
            <Polyline
              key={r.id}
              positions={r.points.map((p) => [p.lat, p.lng])}
              pathOptions={{
                color: r.color || C.primary,
                weight: 4,
                opacity: 0.85,
                dashArray: r.dashed ? '6 4' : undefined,
              }}
            />
          ) : null
        )}

        {/* Markers */}
        {markers.map((m) => {
          if (!Number.isFinite(m.lat) || !Number.isFinite(m.lng)) return null;
          const key = `${m.color || C.primary}|${m.number ?? ''}|${m.iconSvg || ''}|${m.highlight ? '1' : '0'}|${m.shape || 'circle'}`;
          const icon = iconsByKey.get(key);
          return (
            <Marker
              key={m.id}
              position={[m.lat, m.lng]}
              icon={icon}
              eventHandlers={
                onMarkerClick ? { click: () => onMarkerClick(m) } : undefined
              }
            >
              {renderTooltip && (
                <Tooltip
                  direction="top"
                  offset={[0, -24]}
                  sticky
                  className={tooltipClassName || undefined}
                >
                  {renderTooltip(m)}
                </Tooltip>
              )}
              {renderPopup && <Popup>{renderPopup(m)}</Popup>}
            </Marker>
          );
        })}
      </MapContainer>

      {/* Overlay slot — floating buttons, legends, etc. */}
      {children}
    </div>
  );
}
