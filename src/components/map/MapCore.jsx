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

// Leaflet's default-icon URL detection breaks under Vite. The same shim
// existed inline in FindGarage.jsx; centralised here so every consumer
// of MapCore inherits it without re-running.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// Pulsing blue dot for the user's own position.
const userIcon = new L.DivIcon({
  className: '',
  html: `<div style="position:relative;width:20px;height:20px;">
    <div style="position:absolute;inset:-6px;border-radius:50%;background:rgba(59,130,246,0.2);animation:pulse-ring 2s ease-out infinite;"></div>
    <div style="width:20px;height:20px;border-radius:50%;background:#3B82F6;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>
  </div><style>@keyframes pulse-ring{0%{transform:scale(1);opacity:1}100%{transform:scale(2.2);opacity:0}}</style>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

// Build a circular DivIcon: numbered, custom SVG, or solid colored dot.
// `highlight: true` paints an extra outer ring + grows the icon — used by
// the route maps to flag the stop the driver should hit next.
// Returns a Leaflet DivIcon ready to pass to <Marker icon=...>.
function buildMarkerIcon({ color = '#2D5233', number, iconSvg, highlight = false, size = 38 }) {
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
  circleColor = '#2D5233',
  circleRadius = 5000,
  scrollWheelZoom = true,
  tooltipClassName = '',
  className = '',
  mapRef: externalMapRef,
  children,
}) {
  const internalMapRef = useRef(null);
  const mapRef = externalMapRef || internalMapRef;

  // Cache icons per (color, number, iconSvg, highlight) so panning a
  // 50-marker map doesn't allocate 50 new DivIcons on every render.
  const iconsByKey = useMemo(() => {
    const cache = new Map();
    for (const m of markers) {
      const key = `${m.color || '#2D5233'}|${m.number ?? ''}|${m.iconSvg || ''}|${m.highlight ? '1' : '0'}`;
      if (!cache.has(key)) {
        cache.set(
          key,
          buildMarkerIcon({ color: m.color, number: m.number, iconSvg: m.iconSvg, highlight: !!m.highlight })
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
          background: '#F9FAFB',
          border: '1.5px solid #E5E7EB',
        }}
        dir="rtl"
      >
        <p className="text-sm text-gray-500">{emptyStateMessage}</p>
      </div>
    );
  }

  return (
    <div
      className={`rounded-2xl overflow-hidden shadow-md border ${className}`}
      style={{
        height: mapHeight,
        minHeight: mapMinHeight,
        maxHeight: mapMaxHeight,
        position: 'relative',
        zIndex: 1,
        borderColor: '#E5E7EB',
      }}
    >
      <MapContainer
        center={effectiveCenter}
        zoom={zoom}
        scrollWheelZoom={scrollWheelZoom}
        style={{ height: '100%', width: '100%' }}
        ref={mapRef}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
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
                color: r.color || '#2D5233',
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
          const key = `${m.color || '#2D5233'}|${m.number ?? ''}|${m.iconSvg || ''}|${m.highlight ? '1' : '0'}`;
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
