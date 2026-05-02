import React, { useState, useEffect, useRef, useCallback } from 'react';
import { C } from '@/lib/designTokens';
import { isVesselType } from '@/lib/designTokens';
import { useAuth } from '@/components/shared/GuestContext';
import { db } from '@/lib/supabaseEntities';
import { MapPin, Wrench, Search, Loader2, MapPinOff, Phone, Star, ArrowUpDown, Anchor, Ship, Package, Settings, LocateFixed } from 'lucide-react';
import { getCurrentPosition } from '@/lib/capacitor';

// Brand SVG marks. used on the directions buttons. Kept inline to avoid extra assets.
const GoogleMapsMark = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2C7.58 2 4 5.58 4 10c0 7 8 12 8 12s8-5 8-12c0-4.42-3.58-8-8-8z" fill="#EA4335"/>
    <circle cx="12" cy="10" r="3" fill="#fff"/>
  </svg>
);

const WazeMark = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3a8 8 0 0 1 8 8c0 1.5-.3 2.4-.8 3.2-.5.8-1 1.3-1 2.3 0 .8.2 1.3.2 1.8 0 .8-.6 1.2-1.3 1.2-.8 0-1.4-.4-2-1-.6-.5-1.2-1-2.1-1H9c-1 0-1.7.5-2.3 1-.6.5-1.2 1-2 1-.7 0-1.3-.4-1.3-1.2 0-.5.2-1 .2-1.8 0-1-.5-1.5-1-2.3S2 12.5 2 11a8 8 0 0 1 8-8h2z" fill="#33CCFF"/>
    <circle cx="9" cy="11" r="1.2" fill="#fff"/>
    <circle cx="15" cy="11" r="1.2" fill="#fff"/>
    <path d="M9 14.5c.8.8 2 1.2 3 1.2s2.2-.4 3-1.2" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
  </svg>
);

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup, Tooltip, Circle, useMap } from 'react-leaflet';

import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl: markerIcon2x, iconUrl: markerIcon, shadowUrl: markerShadow });

//  Type definitions with colors & icons 
const TYPE_CONFIG = {
  garage: {
    label: 'מוסך',
    color: '#2D5233',
    bg: '#E8F5E9',
    border: '#A5D6A7',
    // wrench SVG
    svg: `<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>`,
  },
  tire: {
    label: 'פנצ\'ריה',
    color: '#E65100',
    bg: '#FFF3E0',
    border: '#FFCC80',
    // circle SVG (tire)
    svg: `<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>`,
  },
  parts: {
    label: 'חנות חלקים',
    color: '#1565C0',
    bg: '#E3F2FD',
    border: '#90CAF9',
    // package/box SVG
    svg: `<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>`,
  },
  mechanic: {
    label: 'מכונאי',
    color: '#6A1B9A',
    bg: '#F3E5F5',
    border: '#CE93D8',
    // settings/gear SVG
    svg: `<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>`,
  },
};

//  Marine type definitions (shown only when user has a vessel) 
const MARINE_TYPE_CONFIG = {
  marina: {
    label: 'מרינה',
    color: '#00695C',
    bg: '#E0F2F1',
    border: '#80CBC4',
    // anchor SVG
    svg: `<circle cx="12" cy="5" r="3"/><line x1="12" y1="22" x2="12" y2="8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/>`,
  },
  boat_repair: {
    label: 'מספנה',
    color: '#0277BD',
    bg: '#E1F5FE',
    border: '#81D4FA',
    // ship/sailboat SVG
    svg: `<path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76"/><path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/>`,
  },
  marine_parts: {
    label: 'ציוד ימי',
    color: '#1A237E',
    bg: '#E8EAF6',
    border: '#9FA8DA',
    // lifebuoy/compass SVG
    svg: `<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="8"/><line x1="12" y1="16" x2="12" y2="22"/><line x1="2" y1="12" x2="8" y2="12"/><line x1="16" y1="12" x2="22" y2="12"/>`,
  },
};

// Short descriptions per type
const TYPE_DESC = {
  garage: 'תיקון ואחזקת רכבים',
  tire: 'תיקון והחלפת צמיגים',
  parts: 'מכירת חלקי חילוף לרכב',
  mechanic: 'מכונאי רכב עצמאי',
  marina: 'עגינה ושירותים לכלי שייט',
  boat_repair: 'תיקון ואחזקת כלי שייט',
  marine_parts: 'ציוד ואביזרים ימיים',
};

const ALL_TYPE_CONFIG = { ...TYPE_CONFIG, ...MARINE_TYPE_CONFIG };

// Safe icon mapping (no dangerouslySetInnerHTML)
const TYPE_ICONS = {
  garage: Wrench, tire: Settings, parts: Package, mechanic: Settings,
  marina: Anchor, boat_repair: Ship, marine_parts: Anchor,
};

function makeIcon(typeKey) {
  const t = ALL_TYPE_CONFIG[typeKey] || TYPE_CONFIG.garage;
  return new L.DivIcon({
    className: '',
    html: `<div style="width:38px;height:38px;border-radius:50%;background:${t.color};border:3px solid #fff;box-shadow:0 2px 10px ${t.color}60;display:flex;align-items:center;justify-content:center;">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${t.svg}</svg>
    </div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -22],
  });
}

// Pre-build icons for all types (car + marine)
const ICONS = {};
Object.keys(ALL_TYPE_CONFIG).forEach(k => { ICONS[k] = makeIcon(k); });

// Blue pulsing dot for user
const userIcon = new L.DivIcon({
  className: '',
  html: `<div style="position:relative;width:20px;height:20px;">
    <div style="position:absolute;inset:-6px;border-radius:50%;background:rgba(59,130,246,0.2);animation:pulse-ring 2s ease-out infinite;"></div>
    <div style="width:20px;height:20px;border-radius:50%;background:#3B82F6;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>
  </div><style>@keyframes pulse-ring{0%{transform:scale(1);opacity:1}100%{transform:scale(2.2);opacity:0}}</style>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function RecenterMap({ center, zoom }) {
  const map = useMap();
  useEffect(() => { if (center) map.setView(center, zoom); }, [center, zoom, map]);
  return null;
}

function classifyType(tags, isMarine = false) {
  if (!tags) return isMarine ? 'boat_repair' : 'garage';
  // Marine types
  if (isMarine) {
    // OSM serializes `seamark:type` as a flat key — `tags.seamark?.type`
    // (the old code) was always undefined and silently classified every
    // harbour as boat_repair. Use the bracket access.
    if (tags.leisure === 'marina' || tags['seamark:type'] === 'harbour') return 'marina';
    if (tags.shop === 'boat' || tags.shop === 'ship_chandler' || tags.shop === 'fishing' ||
        (tags.name && /ציוד ימי|ימאות|דיג|ship/.test(tags.name))) return 'marine_parts';
    return 'boat_repair';
  }
  // Car types
  if (tags.shop === 'tyres' || tags.craft === 'tyre' || (tags.name && /פנצ[רי]/.test(tags.name))) return 'tire';
  if (tags.shop === 'car_parts') return 'parts';
  // 'craft=mechanic' is intentionally NOT a primary signal — in OSM that
  // tag covers general mechanics (industrial / non-vehicle) and brings
  // in unrelated results. We only keep it if combined with car_repair.
  return 'garage';
}

// Pick a human-friendly display name from an OSM tag bag. Hebrew-first,
// then English, then brand/operator. Returns null when there's nothing
// recognisable — callers drop those entries instead of showing "מוסך"
// as a name (which made every unnamed POI look like a real result).
function pickDisplayName(tags) {
  if (!tags) return null;
  const heChar = /[\u0590-\u05FF]/;
  const candidates = [
    tags['name:he'],
    tags.name,                 // OSM `name` is supposed to be primary local language
    tags['name:en'],
    tags['official_name'],
    tags['alt_name'],
    tags.brand,
    tags.operator,
  ];
  // Prefer the first candidate that has Hebrew characters.
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() && heChar.test(c)) return c.trim();
  }
  // No Hebrew → take the first non-empty candidate at all.
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

const RADIUS_MIN = 1000;
const RADIUS_MAX = 25000;
const RADIUS_STEP = 1000;

const QUICK_CITIES = [
  { name: 'תל אביב', lat: 32.0853, lng: 34.7818 },
  { name: 'ירושלים', lat: 31.7683, lng: 35.2137 },
  { name: 'חיפה', lat: 32.7940, lng: 34.9896 },
  { name: 'באר שבע', lat: 31.2530, lng: 34.7915 },
  { name: 'ראשל"צ', lat: 31.9642, lng: 34.8047 },
  { name: 'נתניה', lat: 32.3215, lng: 34.8532 },
];

export default function FindGarage() {
  const { isGuest, guestVehicles, isAuthenticated, user } = useAuth();
  const [userLocation, setUserLocation] = useState(null);
  const [garages, setGarages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locError, setLocError] = useState(null);
  const [searchRadius, setSearchRadius] = useState(5000);
  const [fetching, setFetching] = useState(false);
  const [selectedGarage, setSelectedGarage] = useState(null);
  const [cityQuery, setCityQuery] = useState('');
  const [searchingCity, setSearchingCity] = useState(false);
  const [sortBy, setSortBy] = useState('distance'); // 'distance' | 'name'
  const [filterType, setFilterType] = useState('all');
  const [nameQuery, setNameQuery] = useState('');
  const [hasVessel, setHasVessel] = useState(false);
  const mapRef = useRef(null);
  const retryRef = useRef(false);

  // Detect if user has a vessel in their fleet
  useEffect(() => {
    if (isGuest) {
      const found = (guestVehicles || []).some(v => isVesselType(v.vehicle_type, v.nickname));
      setHasVessel(found);
    } else if (isAuthenticated && user) {
      (async () => {
        try {
          const vehicles = await db.vehicles.filter({ account_id: user.account_id });
          setHasVessel(vehicles.some(v => isVesselType(v.vehicle_type, v.nickname)));
        } catch { /* ignore */ }
      })();
    }
  }, [isGuest, guestVehicles, isAuthenticated, user]);

  // Location state. Tracks both "using real GPS vs. Tel Aviv fallback"
  // and whether we got here because permission was denied (so we can
  // surface a distinct banner + "try again" button to the user). The
  // old flow fell back to Tel Aviv silently whenever anything went
  // wrong, which users interpreted as a bug.
  // `usingGps` was driving a "GPS פעיל" pill on the removed top button
  // and is no longer read anywhere — kept the setter calls as a no-op
  // ref slot in case we add a future GPS-state pill back. State stripped.
  const [locationDenied, setLocationDenied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // getCurrentPosition from @/lib/capacitor routes through the
        // native Geolocation plugin on Android/iOS, which triggers the
        // OS permission dialog if needed. On web it falls back to
        // navigator.geolocation.
        const pos = await getCurrentPosition();
        if (cancelled) return;
        setUserLocation({ lat: pos.latitude, lng: pos.longitude });
        setLocationDenied(false);
      } catch (err) {
        if (cancelled) return;
        // PERMISSION_DENIED = 1 on browser GeolocationPositionError.
        // Native plugin throws an Error whose message contains "denied"
        // or "not authorized" — sniff both so we can show the right UX.
        const msg = String(err?.message || err || '').toLowerCase();
        const denied = err?.code === 1 || msg.includes('denied') || msg.includes('not authorized');
        setLocationDenied(denied);
        // Keep the Tel Aviv fallback so the map is not blank, but the
        // banner above makes the fallback clear instead of pretending
        // this is the user's real location.
        setUserLocation({ lat: 32.0853, lng: 34.7818 });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const retryGps = async () => {
    setLocError(null);
    try {
      const pos = await getCurrentPosition();
      setUserLocation({ lat: pos.latitude, lng: pos.longitude });
      setLocationDenied(false);
      // Snap the map back to the new location.
      if (mapRef.current) {
        try { mapRef.current.setView([pos.latitude, pos.longitude], 14, { animate: true }); } catch {}
      }
    } catch (err) {
      const msg = String(err?.message || err || '').toLowerCase();
      const denied = err?.code === 1 || msg.includes('denied') || msg.includes('not authorized');
      setLocationDenied(denied);
      setLocError(denied ? 'הרשאת מיקום נדחתה. אפשר לאפשר בהגדרות האפליקציה.' : 'לא הצלחנו לזהות מיקום');
      setTimeout(() => setLocError(null), 4000);
    }
  };

  // Fetch garages - includes tyres, with retry on alternate server
  const OVERPASS_SERVERS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  // Stale-while-revalidate cache for Overpass results.
  //   Key: rounded lat/lng (1km grid) + radius + vessel flag
  //   TTL: 24h. garages don't appear/disappear often; users can pull-to-refresh
  //   Strategy: on hit, render cached results instantly + fetch in background
  // Bumped to v3 when we removed the expensive `[~"^name(:he)?$"~"."]`
  // regex from the Overpass query — the regex was pushing the merged
  // query past Overpass's 25s ceiling and every request came back with
  // `remark: timeout, elements: []`. The legacy `fetchFromServers`
  // treated that 200-OK as success, cached the empty array, and v2
  // users got "no results" for 24h until TTL expiry. v3 cache is
  // populated only by responses that actually contained data.
  const CACHE_VERSION = 'fg_v3';

  // Sweep stale v1/v2 cache rows once per mount. localStorage on iOS
  // WebView has a tight quota — if we only bumped the key prefix without
  // cleaning, every old payload would sit there until the user clears
  // app data. Single linear scan, runs only on this page.
  useEffect(() => {
    try {
      const stale = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('fg_v1:') || k.startsWith('fg_v2:'))) stale.push(k);
      }
      stale.forEach(k => localStorage.removeItem(k));
    } catch { /* no-op: quota errors / private mode */ }
  }, []);
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const cacheKey = (lat, lng, r, hasV) => {
    // Round to ~0.01° (~1km) so minor GPS drift doesn't miss the cache
    const la = Math.round(lat * 100) / 100;
    const lo = Math.round(lng * 100) / 100;
    return `${CACHE_VERSION}:${la}:${lo}:${r}:${hasV ? 1 : 0}`;
  };
  const readCache = (key) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const { savedAt, data } = JSON.parse(raw);
      if (Date.now() - savedAt > CACHE_TTL_MS) return null;
      return data;
    } catch { return null; }
  };
  const writeCache = (key, data) => {
    try { localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data })); } catch {}
  };

  const fetchGarages = useCallback(async () => {
    if (!userLocation) return;
    const { lat, lng } = userLocation;
    const r = searchRadius;
    const key = cacheKey(lat, lng, r, hasVessel);

    // Show cached results immediately if we have them (stale-while-revalidate)
    const cached = readCache(key);
    if (cached) {
      setGarages(cached);
      // don't block on spinner for revalidation
    } else {
      setFetching(true);
    }

    try {

      // Car query — design notes:
      //   * `nwr` (node+way+relation) catches large garages mapped as
      //     polygons that the old `node`-only filter missed.
      //   * `out center tags;` returns each entity's center point in
      //     `el.center.{lat,lon}` for ways/relations, alongside `el.lat`
      //     for nodes. The JS accessor below handles both.
      //   * `["name"]` filters at the OSM level — saves bandwidth and
      //     drops noise. Unnamed entries can't be displayed usefully
      //     anyway and were the cause of the duplicate-"מוסך" bug.
      //   * Removed `craft=mechanic` and `craft=tyre` (too broad — they
      //     cover industrial mechanics / tyre-makers, not vehicle service).
      //   * Added `service:vehicle:*` namespace (modern OSM convention
      //     for gas stations / dealerships that also do repair).
      // No Overpass-side name filter. The previous version applied a
      // regex `[~"^name(:he)?$"~"."]` to every union sub-query so that
      // Hebrew-only POIs (only `name:he`) would still match — but the
      // regex evaluation pushed the merged query past Overpass's 25s
      // runtime ceiling and the server returned `runtime error: Query
      // timed out` with zero results.
      //
      // We rely on JS-side filtering instead: `toRow` already drops
      // any entry whose `pickDisplayName(tags)` returns empty, so
      // unnamed rows never reach the UI. The extra ~10-50 unnamed
      // entries that come back per query are filtered in O(n) JS
      // and the response is fast.
      const carQuery = `[out:json][timeout:25];(`
        + `nwr["shop"="car_repair"](around:${r},${lat},${lng});`
        + `nwr["shop"="tyres"](around:${r},${lat},${lng});`
        + `nwr["shop"="car_parts"](around:${r},${lat},${lng});`
        + `nwr["service:vehicle:car_repair"="yes"](around:${r},${lat},${lng});`
        + `nwr["service:vehicle:tyres"="yes"](around:${r},${lat},${lng});`
        + `nwr["service:vehicle:body_repair"="yes"](around:${r},${lat},${lng});`
        + `);out center tags;`;

      // Marine query (only if user has vessels). Same logic — drop the
      // server-side name regex; `toRow` filters unnamed entries in JS.
      const marineQuery = hasVessel
        ? `[out:json][timeout:25];(`
          + `nwr["leisure"="marina"](around:${r},${lat},${lng});`
          + `nwr["shop"="boat"](around:${r},${lat},${lng});`
          + `nwr["shop"="ship_chandler"](around:${r},${lat},${lng});`
          + `nwr["craft"="boatbuilder"](around:${r},${lat},${lng});`
          + `nwr["seamark:type"="harbour"](around:${r},${lat},${lng});`
          + `nwr["shop"="fishing"](around:${r},${lat},${lng});`
          + `);out center tags;`
        : null;

      const hdrs = { 'Content-Type': 'application/x-www-form-urlencoded' };

      // Fetch with multi-server fallback. Overpass returns HTTP 200 with
      // `{remark: "runtime error: Query timed out ..."}` and an empty
      // `elements` array when a query exceeds the timeout — we treat
      // that as a failure (try next server) so we never cache an empty
      // payload from a server-side timeout.
      const fetchFromServers = async (q) => {
        for (const server of OVERPASS_SERVERS) {
          try {
            const res = await fetch(server, { method: 'POST', body: `data=${encodeURIComponent(q)}`, headers: hdrs });
            if (!res.ok) continue;
            const ct = res.headers.get('content-type') || '';
            if (!ct.includes('json')) continue;
            const json = await res.json();
            if (json && typeof json.remark === 'string' && /timed out|runtime error/i.test(json.remark)) {
              continue; // Server-side timeout/runtime error — try next server
            }
            return json;
          } catch { /* try next server */ }
        }
        return null;
      };

      // Fetch car + marine in parallel
      const [carData, marineData] = await Promise.all([
        fetchFromServers(carQuery),
        marineQuery ? fetchFromServers(marineQuery) : Promise.resolve(null),
      ]);

      if (!carData) {
        console.warn('Overpass API temporarily unavailable');
        // Retry once after 3 seconds
        if (!retryRef.current) {
          retryRef.current = true;
          setTimeout(() => { retryRef.current = false; fetchGarages(); }, 3000);
        }
        setFetching(false);
        return;
      }

      // Skip entries that look closed/abandoned. OSM uses lifecycle
      // prefixes (`disused:shop=car_repair`) on the *key* side; if any
      // such key is present the place isn't actively operating.
      const isLive = (tags) => {
        if (!tags) return false;
        const dead = ['disused:', 'abandoned:', 'was:', 'closed:'];
        for (const k of Object.keys(tags)) {
          if (dead.some(p => k.startsWith(p))) return false;
        }
        return true;
      };

      // `el.center.{lat,lon}` is provided by `out center;` for ways and
      // relations; nodes still have top-level `el.lat / el.lon`. We try
      // node first to keep the fast path fast.
      const coordsOf = (el) => ({
        lat: el.lat ?? el.center?.lat ?? null,
        lon: el.lon ?? el.center?.lon ?? null,
      });

      const toRow = (el, isMarine) => {
        const { lat: eLat, lon: eLon } = coordsOf(el);
        if (eLat == null || eLon == null) return null;
        if (!isLive(el.tags)) return null;
        const displayName = pickDisplayName(el.tags);
        // Hard requirement: drop entries with no usable name. The old
        // fallback to the type label ("מוסך") produced rows of identical
        // names and was the user-visible shape of this bug.
        if (!displayName) return null;
        const typeKey = classifyType(el.tags, isMarine);
        return {
          id: `${el.type || 'n'}-${el.id}`,
          name: displayName,
          lat: eLat, lon: eLon,
          distance: haversineDistance(lat, lng, eLat, eLon),
          address: [el.tags?.['addr:street'], el.tags?.['addr:housenumber'], el.tags?.['addr:city']].filter(Boolean).join(' ') || '',
          phone: el.tags?.phone || el.tags?.['contact:phone'] || '',
          typeKey,
          openingHours: el.tags?.opening_hours || '',
        };
      };

      // Process car results
      const carResults = (carData.elements || [])
        .map(el => toRow(el, false))
        .filter(Boolean);

      // Process marine results
      const marineResults = marineData
        ? (marineData.elements || []).map(el => toRow(el, true)).filter(Boolean)
        : [];

      // Merge, deduplicate by id, sort
      const seenIds = new Set();
      const results = [...carResults, ...marineResults].filter(r => {
        if (seenIds.has(r.id)) return false;
        seenIds.add(r.id);
        return true;
      });
      results.sort((a, b) => a.distance - b.distance);
      setGarages(results);
      writeCache(key, results);
    } catch (err) {
      console.error('Overpass fetch error:', err);
      if (!cached) setGarages([]); // only wipe if we had nothing to show
    }
    finally { setFetching(false); }
  }, [userLocation, searchRadius, hasVessel]);

  // Debounce fetch to avoid multiple rapid calls
  useEffect(() => {
    const timer = setTimeout(() => fetchGarages(), 300);
    return () => clearTimeout(timer);
  }, [fetchGarages]);

  // City search
  const searchByCity = async (q) => {
    if (!q.trim()) return;
    setSearchingCity(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ' ישראל')}&format=json&limit=1&countrycodes=il`, { headers: { 'Accept-Language': 'he' } });
      const data = await res.json();
      if (data.length > 0) { setLocError(null); setUserLocation({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }); }
      else { setLocError('לא נמצאה כתובת.'); }
    } catch { setLocError('שגיאה בחיפוש.'); }
    finally { setSearchingCity(false); }
  };

  const openGoogleNav = (lat, lon) => window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`, '_blank');
  const openWazeNav = (lat, lon) => window.open(`https://waze.com/ul?ll=${lat},${lon}&navigate=yes`, '_blank');
  const openGoogleSearch = (name, lat, lon) => window.open(`https://www.google.com/maps/search/${encodeURIComponent(name)}/@${lat},${lon},17z`, '_blank');
  const scrollToCard = (id) => { const el = document.getElementById(`garage-card-${id}`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); };

  // Filtered & sorted garages
  const displayGarages = garages
    .filter(g => filterType === 'all' || g.typeKey === filterType)
    .filter(g => !nameQuery.trim() || g.name.includes(nameQuery.trim()))
    .sort((a, b) => sortBy === 'name' ? a.name.localeCompare(b.name, 'he') : a.distance - b.distance);

  // Type counts
  const typeCounts = { all: garages.length };
  garages.forEach(g => { typeCounts[g.typeKey] = (typeCounts[g.typeKey] || 0) + 1; });

  //  Loading 
  if (loading) {
    return (
      <div className="-mx-4 -mt-4 min-h-[85vh] flex flex-col items-center justify-center gap-5 relative overflow-hidden pb-24" dir="rtl">
        <div className="absolute inset-0" style={{ background: C.grad }} />
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }} />
        <div className="relative z-10 flex flex-col items-center gap-4">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.15)' }}>
            <Loader2 className="w-10 h-10 animate-spin text-white" />
          </div>
          <p className="text-lg font-bold text-white">מאתר את המיקום שלך...</p>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>אנא אשר גישה למיקום</p>
        </div>
      </div>
    );
  }

  // Error screen removed. we always fallback to Tel Aviv, so main view always shows

  //  Main view 
  return (
    <div className="-mx-4 -mt-4" style={{ maxWidth: '100vw', overflowX: 'hidden' }} dir="rtl">
      {/* Hero header */}
      <div className="px-4 pt-4 pb-3 relative" style={{ background: C.grad }}>
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-16 -left-16 w-48 h-48 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }} />
          <div className="absolute -bottom-8 -right-8 w-32 h-32 rounded-full" style={{ background: `${C.yellow}15` }} />
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(255,255,255,0.2)' }}>
              <MapPin className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-white truncate">{hasVessel ? 'מצא מוסך / מרינה' : 'מצא מוסך קרוב'}</h1>
              <p className="text-[10px] font-medium truncate" style={{ color: 'rgba(255,255,255,0.65)' }}>
                {hasVessel ? 'מוסכים, חלפים, מרינות ושירותי שייט' : 'מוסכים, מכונאים וחנויות חלפים'}
              </p>
            </div>
          </div>

          {/* Location-denied banner. Shown when the OS permission was
              refused so the user knows why the map is parked on Tel Aviv.
              The user can retry GPS via the floating "recenter to my
              location" button on the map (LocateFixed icon, bottom-left)
              or pick a city from the search/chips below. */}
          {locationDenied && (
            <div className="mb-2 rounded-lg px-3 py-2 flex items-start gap-2"
              style={{ background: 'rgba(255,191,0,0.15)', border: '1px solid rgba(255,191,0,0.3)' }}>
              <MapPinOff className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#FFBF00' }} />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-white">הרשאת מיקום חסרה</p>
                <p className="text-[10px] leading-tight" style={{ color: 'rgba(255,255,255,0.75)' }}>
                  אנחנו מציגים את תל אביב כברירת מחדל. אשר גישה למיקום בהגדרות או חפש עיר אחרת למטה.
                </p>
              </div>
            </div>
          )}

          {/* City search — the "מיקום" GPS-retry button used to live here
              too, but the floating LocateFixed button on the map already
              covers that action, so we removed the redundant copy. */}
          <div className="flex gap-1.5 mb-2">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/50" />
              <input
                value={cityQuery}
                onChange={e => setCityQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') searchByCity(cityQuery); }}
                placeholder="חפש עיר..."
                dir="rtl"
                className="w-full h-9 pr-8 pl-2 rounded-lg text-[12px] font-medium outline-none placeholder:text-white/40"
                style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' }}
              />
            </div>
            <button onClick={() => searchByCity(cityQuery)} disabled={searchingCity || !cityQuery.trim()}
              className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0 disabled:opacity-50 transition-all active:scale-[0.95]"
              style={{ background: C.yellow, color: C.greenDark }}>
              {searchingCity ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Quick city chips */}
          <div className="flex gap-1 overflow-x-auto scrollbar-hide mb-2 -mx-0.5 px-0.5">
            {QUICK_CITIES.map(city => (
              <button key={city.name}
                onClick={() => { setCityQuery(''); setUserLocation({ lat: city.lat, lng: city.lng }); }}
                className="px-2.5 py-1 rounded-md text-[10px] font-bold shrink-0 transition-all active:scale-[0.95]"
                style={{ background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)' }}>
                {city.name}
              </button>
            ))}
          </div>
          {locError && <p className="text-[10px] font-medium text-amber-300 mb-1">{locError}</p>}

          {/* Radius slider + Sort */}
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] text-white/60">רדיוס:</span>
                <span className="text-[11px] font-bold text-white">{(searchRadius / 1000).toFixed(0)} ק"מ</span>
              </div>
              <input
                type="range" min={RADIUS_MIN} max={RADIUS_MAX} step={RADIUS_STEP} value={searchRadius}
                onChange={e => setSearchRadius(Number(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to left, ${C.yellow} ${((searchRadius - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN)) * 100}%, rgba(255,255,255,0.2) ${((searchRadius - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN)) * 100}%)`,
                  accentColor: C.yellow,
                }}
              />
            </div>
            <button onClick={() => setSortBy(s => s === 'distance' ? 'name' : 'distance')}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold shrink-0"
              style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}>
              <ArrowUpDown className="w-3 h-3" />
              {sortBy === 'distance' ? 'מרחק' : 'שם'}
            </button>
          </div>
          {fetching && <Loader2 className="w-4 h-4 animate-spin text-white/70 mt-1" />}
        </div>
      </div>

      {/* Type filter pills */}
      <div className="px-3 -mt-1 mb-2 relative z-10">
        <div className="flex gap-1.5 overflow-x-auto py-2 scrollbar-hide">
          {[
            { key: 'all', label: 'הכל', color: C.primary, bg: C.light },
            ...Object.entries(TYPE_CONFIG).map(([key, val]) => ({ key, label: val.label, color: val.color, bg: val.bg })),
            ...(hasVessel ? Object.entries(MARINE_TYPE_CONFIG).map(([key, val]) => ({ key, label: val.label, color: val.color, bg: val.bg })) : []),
          ].map(f => (
            <button key={f.key} onClick={() => setFilterType(f.key)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold shrink-0 transition-all"
              style={{
                background: filterType === f.key ? f.color : f.bg,
                color: filterType === f.key ? '#fff' : f.color,
                border: `1.5px solid ${filterType === f.key ? f.color : f.color + '40'}`,
                boxShadow: filterType === f.key ? `0 2px 8px ${f.color}40` : 'none',
              }}>
              {f.label}
              {typeCounts[f.key] > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                  style={{ background: filterType === f.key ? 'rgba(255,255,255,0.3)' : f.color + '20', color: filterType === f.key ? '#fff' : f.color }}>
                  {typeCounts[f.key]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Name search */}
      <div className="px-3 mb-2">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: C.muted }} />
          <input
            value={nameQuery}
            onChange={e => setNameQuery(e.target.value)}
            placeholder="חפש מוסך לפי שם..."
            dir="rtl"
            className="w-full h-10 pr-9 pl-8 rounded-xl text-[13px] font-medium outline-none transition-all"
            style={{ background: '#fff', border: `1.5px solid ${C.border}`, color: C.text }}
            onFocus={e => e.target.style.borderColor = C.primary}
            onBlur={e => e.target.style.borderColor = C.border}
          />
          {nameQuery && (
            <button onClick={() => setNameQuery('')}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center"
              style={{ background: C.border, color: C.muted }}>
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Map */}
      <div className="px-3">
        <div>
          <div className="rounded-2xl overflow-hidden shadow-md border" style={{ borderColor: C.border, height: '35vh', minHeight: '200px', maxHeight: '350px', position: 'relative', zIndex: 1 }}>
            {userLocation && (
              <MapContainer center={[userLocation.lat, userLocation.lng]} zoom={14} scrollWheelZoom={true}
                style={{ height: '100%', width: '100%' }} ref={mapRef}>
                <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <RecenterMap center={[userLocation.lat, userLocation.lng]} zoom={searchRadius <= 2000 ? 15 : searchRadius <= 5000 ? 14 : 12} />
                <Circle center={[userLocation.lat, userLocation.lng]} radius={searchRadius}
                  pathOptions={{ color: C.primary, fillColor: C.light, fillOpacity: 0.08, weight: 1.5, dashArray: '6 4' }} />
                <Marker position={[userLocation.lat, userLocation.lng]} icon={userIcon}>
                  <Popup><div className="text-center text-sm font-medium" dir="rtl">המיקום שלך</div></Popup>
                </Marker>
                {displayGarages.map(g => {
                  const tc = ALL_TYPE_CONFIG[g.typeKey] || TYPE_CONFIG.garage;
                  return (
                  <Marker key={g.id} position={[g.lat, g.lon]} icon={ICONS[g.typeKey] || ICONS.garage}
                    eventHandlers={{ click: () => { setSelectedGarage(g.id); scrollToCard(g.id); } }}>
                    <Tooltip direction="top" offset={[0, -24]} sticky className="garage-tooltip">
                      <div dir="rtl" style={{ minWidth: 160, fontFamily: 'inherit' }}>
                        <div style={{ fontWeight: 800, fontSize: 13, color: tc.color, marginBottom: 2 }}>{g.name}</div>
                        <div style={{ fontSize: 11, color: '#666' }}>{TYPE_DESC[g.typeKey] || tc.label}</div>
                        <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{g.distance.toFixed(1)} ק"מ ממך</div>
                      </div>
                    </Tooltip>
                    <Popup>
                      <div dir="rtl" className="min-w-[200px]">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: tc.color }} />
                          <p className="font-bold text-sm">{g.name}</p>
                        </div>
                        <p className="text-xs text-gray-500 mb-1">{tc.label} · {g.distance.toFixed(1)} ק"מ</p>
                        {g.address && <p className="text-xs text-gray-400 mb-2">{g.address}</p>}
                        <div className="flex gap-1.5">
                          <button onClick={() => openGoogleNav(g.lat, g.lon)}
                            className="flex-1 flex items-center justify-center gap-1 text-xs rounded-lg px-2 py-1.5 font-bold"
                            style={{ background: '#fff', border: '1px solid #E5E7EB', color: '#202124' }}>
                            <GoogleMapsMark size={13} /> Google Maps
                          </button>
                          <button onClick={() => openWazeNav(g.lat, g.lon)}
                            className="flex-1 flex items-center justify-center gap-1 text-xs rounded-lg px-2 py-1.5 font-bold"
                            style={{ background: '#fff', border: '1px solid #E5E7EB', color: '#0A73B8' }}>
                            <WazeMark size={13} /> Waze
                          </button>
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                  );
                })}
              </MapContainer>
            )}

            {/* Floating "recenter to my location" button. bottom-left of map in RTL feels natural for left-hand thumbs */}
            {userLocation && (
              <button
                onClick={retryGps}
                aria-label="חזרה למיקום שלי"
                title="חזרה למיקום שלי"
                className="absolute bottom-3 left-3 w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-95"
                style={{
                  background: '#fff',
                  border: `1.5px solid ${C.border}`,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  zIndex: 400,
                  color: C.primary,
                }}>
                <LocateFixed className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Results header */}
      <div className="px-3 mt-3">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-bold" style={{ color: C.text }}>
            {fetching ? 'מחפש...' : displayGarages.length > 0 ? `נמצאו ${displayGarages.length} תוצאות` : 'לא נמצאו תוצאות'}
          </p>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
            style={{ background: C.light, color: C.primary }}>
            {sortBy === 'distance' ? 'לפי מרחק' : 'לפי שם'}
          </span>
        </div>
      </div>

      {/* Legend */}
      <div className="px-3 mt-1.5">
        <div className="flex gap-2.5 flex-wrap">
          {Object.entries(TYPE_CONFIG).map(([key, val]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full" style={{ background: val.color }} />
              <span className="text-[11px] font-medium" style={{ color: val.color }}>{val.label}</span>
            </div>
          ))}
          {hasVessel && Object.entries(MARINE_TYPE_CONFIG).map(([key, val]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full" style={{ background: val.color }} />
              <span className="text-[11px] font-medium" style={{ color: val.color }}>{val.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Garage cards */}
      <div className="px-3 mt-2 pb-28">
        <div className="space-y-2.5">
          {/* Initial fetch skeleton. Overpass API can take 5-10s */}
          {fetching && displayGarages.length === 0 && (
            <div className="space-y-2.5" aria-live="polite" aria-busy="true">
              <div className="text-center py-4 px-4 rounded-2xl" style={{ background: '#FFF8E1', border: '1.5px solid #FDE68A' }}>
                <Loader2 className="w-5 h-5 animate-spin mx-auto mb-1.5" style={{ color: '#D97706' }} />
                <p className="text-xs font-bold" style={{ color: '#92400E' }}>מחפש מוסכים באזור...</p>
                <p className="text-[10px] mt-1" style={{ color: '#B45309' }}>החיפוש הראשוני עשוי לקחת מספר שניות</p>
              </div>
              {[0,1,2,3].map(i => (
                <div key={i} className="rounded-2xl p-3 flex items-center gap-3 animate-pulse" style={{ background: '#fff', border: '1px solid #E5E7EB' }}>
                  <div className="w-10 h-10 rounded-xl bg-gray-200" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 rounded bg-gray-200" style={{ width: '60%' }} />
                    <div className="h-2.5 rounded bg-gray-100" style={{ width: '40%' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {!fetching && displayGarages.length === 0 && (
            <div className="text-center py-10 px-4 rounded-2xl border" style={{ background: C.light, borderColor: C.border }}>
              <div className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center" style={{ background: '#fff' }}>
                <Search className="w-7 h-7" style={{ color: C.muted }} />
              </div>
              <p className="font-bold text-sm" style={{ color: C.text }}>לא נמצאו תוצאות באזור</p>
              <p className="text-xs mt-1.5 leading-relaxed" style={{ color: C.muted }}>
                נסה להגדיל את רדיוס החיפוש, לשנות סינון, או לחפש עיר אחרת
              </p>
            </div>
          )}

          {displayGarages.map(g => {
            const tc = ALL_TYPE_CONFIG[g.typeKey] || TYPE_CONFIG.garage;
            const isSelected = selectedGarage === g.id;
            return (
              <div key={g.id} id={`garage-card-${g.id}`}
                className="rounded-2xl p-4 transition-all duration-200 active:scale-[0.99]"
                style={{
                  background: '#fff',
                  border: `1.5px solid ${isSelected ? tc.color : C.border}`,
                  borderRight: `4px solid ${tc.color}`,
                  boxShadow: isSelected ? `0 0 0 3px ${tc.color}12, 0 8px 24px rgba(0,0,0,0.1)` : `0 2px 12px ${tc.color}08`,
                }}
                onClick={() => setSelectedGarage(g.id)}>
                <div className="flex items-start gap-3">
                  {/* Type icon */}
                  <div className="rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: tc.bg, border: `1px solid ${tc.border}`, width: 44, height: 44 }}>
                    {(() => { const Icon = TYPE_ICONS[g.typeKey] || Wrench; return <Icon className="w-5 h-5" style={{ color: tc.color }} />; })()}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Name + distance */}
                    <div className="flex items-start justify-between gap-1.5 mb-0.5">
                      <div className="min-w-0">
                        <h3 className="font-bold text-[13px] truncate" style={{ color: C.text }}>{g.name}</h3>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md inline-block mt-0.5"
                          style={{ background: tc.bg, color: tc.color }}>
                          {tc.label}
                        </span>
                      </div>
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-md shrink-0"
                        style={{ background: tc.bg, color: tc.color }}>
                        {g.distance.toFixed(1)} ק"מ
                      </span>
                    </div>

                    {/* Address */}
                    {g.address && (
                      <p className="text-[11px] mt-1 flex items-center gap-1 truncate" style={{ color: C.muted }}>
                        <MapPin className="w-3 h-3 shrink-0" />{g.address}
                      </p>
                    )}

                    {/* Phone */}
                    {g.phone && (
                      <a href={`tel:${g.phone}`} className="text-[11px] mt-0.5 inline-flex items-center gap-1 font-medium" style={{ color: tc.color }}>
                        <Phone className="w-3 h-3" />{g.phone}
                      </a>
                    )}

                    {/* Action buttons. compact for mobile */}
                    <div className="flex gap-1 mt-2">
                      <button onClick={e => { e.stopPropagation(); openGoogleNav(g.lat, g.lon); }}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-bold transition-all active:scale-[0.95]"
                        style={{ background: '#fff', border: '1px solid #E5E7EB', color: '#202124' }}>
                        <GoogleMapsMark size={14} />
                        Google Maps
                      </button>
                      <button onClick={e => { e.stopPropagation(); openWazeNav(g.lat, g.lon); }}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-bold transition-all active:scale-[0.95]"
                        style={{ background: '#fff', border: '1px solid #E5E7EB', color: '#0A73B8' }}>
                        <WazeMark size={14} />
                        Waze
                      </button>
                      <button onClick={e => { e.stopPropagation(); openGoogleSearch(g.name, g.lat, g.lon); }}
                        className="flex items-center justify-center gap-1 px-3 py-2 rounded-xl text-[11px] font-bold transition-all active:scale-[0.95]"
                        style={{ background: '#FFF8E1', color: '#F57F17' }}>
                        <Star className="w-3 h-3" style={{ color: '#FBBC04' }} />
                        דירוג
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
