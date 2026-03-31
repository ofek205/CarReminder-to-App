import React, { useState, useEffect, useRef, useCallback } from 'react';
import { C } from '@/lib/designTokens';
import { isVesselType } from '@/lib/designTokens';
import { useAuth } from '@/components/shared/GuestContext';
import { db } from '@/lib/supabaseEntities';
import { MapPin, Navigation, Wrench, Search, Loader2, AlertCircle, MapPinOff, Phone, Star, Filter, ArrowUpDown, ExternalLink, Anchor } from 'lucide-react';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup, Tooltip, Circle, useMap } from 'react-leaflet';

import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl: markerIcon2x, iconUrl: markerIcon, shadowUrl: markerShadow });

// ── Type definitions with colors & icons ──────────────────────────────────
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

// ── Marine type definitions (shown only when user has a vessel) ─────────
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
    if (tags.leisure === 'marina' || tags.seamark?.type === 'harbour') return 'marina';
    if (tags.shop === 'boat' || tags.shop === 'ship_chandler' || tags.shop === 'fishing' ||
        (tags.name && /ציוד ימי|ימאות|דיג|ship/.test(tags.name))) return 'marine_parts';
    return 'boat_repair';
  }
  // Car types
  if (tags.shop === 'tyres' || tags.craft === 'tyre' || (tags.name && /פנצ[רי]/.test(tags.name))) return 'tire';
  if (tags.shop === 'car_parts') return 'parts';
  if (tags.craft === 'mechanic') return 'mechanic';
  return 'garage';
}

const RADIUS_OPTIONS = [
  { label: '2 ק"מ', value: 2000 },
  { label: '5 ק"מ', value: 5000 },
  { label: '10 ק"מ', value: 10000 },
];

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

  // Get user location
  useEffect(() => {
    if (!navigator.geolocation) { setLocError('הדפדפן לא תומך באיתור מיקום'); setLoading(false); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLoading(false); },
      (err) => {
        setLocError(err.code === 1 ? 'גישה למיקום נדחתה.' : 'לא ניתן לזהות מיקום.');
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }, []);

  // Fetch garages — includes tyres, with retry on alternate server
  const OVERPASS_SERVERS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  const fetchGarages = useCallback(async () => {
    if (!userLocation) return;
    setFetching(true);
    try {
      const { lat, lng } = userLocation;
      const r = searchRadius;

      // Car query
      const carQuery = `[out:json][timeout:15];(node["shop"="car_repair"](around:${r},${lat},${lng});node["craft"="mechanic"](around:${r},${lat},${lng});node["shop"="car_parts"](around:${r},${lat},${lng});node["shop"="tyres"](around:${r},${lat},${lng});node["craft"="tyre"](around:${r},${lat},${lng}););out body;`;

      // Marine query (only if user has vessels)
      const marineQuery = hasVessel
        ? `[out:json][timeout:15];(node["leisure"="marina"](around:${r},${lat},${lng});node["shop"="boat"](around:${r},${lat},${lng});node["shop"="ship_chandler"](around:${r},${lat},${lng});node["craft"="boatbuilder"](around:${r},${lat},${lng});node["seamark:type"="harbour"](around:${r},${lat},${lng});node["shop"="fishing"](around:${r},${lat},${lng}););out body;`
        : null;

      const hdrs = { 'Content-Type': 'application/x-www-form-urlencoded' };

      // Fetch car results
      const fetchFromServers = async (q) => {
        for (const server of OVERPASS_SERVERS) {
          try {
            const res = await fetch(server, { method: 'POST', body: `data=${encodeURIComponent(q)}`, headers: hdrs });
            if (!res.ok) continue;
            const ct = res.headers.get('content-type') || '';
            if (!ct.includes('json')) continue;
            return await res.json();
          } catch { /* try next server */ }
        }
        return null;
      };

      // Fetch car + marine in parallel
      const [carData, marineData] = await Promise.all([
        fetchFromServers(carQuery),
        marineQuery ? fetchFromServers(marineQuery) : Promise.resolve(null),
      ]);

      if (!carData) throw new Error('All Overpass servers failed');

      // Process car results
      const carResults = (carData.elements || []).map((el) => {
        const dist = haversineDistance(lat, lng, el.lat, el.lon);
        const typeKey = classifyType(el.tags, false);
        return {
          id: el.id,
          name: el.tags?.name || el.tags?.['name:he'] || ALL_TYPE_CONFIG[typeKey].label,
          lat: el.lat, lon: el.lon, distance: dist,
          address: [el.tags?.['addr:street'], el.tags?.['addr:housenumber'], el.tags?.['addr:city']].filter(Boolean).join(' ') || '',
          phone: el.tags?.phone || el.tags?.['contact:phone'] || '',
          typeKey,
          openingHours: el.tags?.opening_hours || '',
        };
      });

      // Process marine results
      const marineResults = marineData ? (marineData.elements || []).map((el) => {
        const dist = haversineDistance(lat, lng, el.lat, el.lon);
        const typeKey = classifyType(el.tags, true);
        return {
          id: el.id,
          name: el.tags?.name || el.tags?.['name:he'] || ALL_TYPE_CONFIG[typeKey].label,
          lat: el.lat, lon: el.lon, distance: dist,
          address: [el.tags?.['addr:street'], el.tags?.['addr:housenumber'], el.tags?.['addr:city']].filter(Boolean).join(' ') || '',
          phone: el.tags?.phone || el.tags?.['contact:phone'] || '',
          typeKey,
          openingHours: el.tags?.opening_hours || '',
        };
      }) : [];

      // Merge, deduplicate by id, sort
      const seenIds = new Set();
      const results = [...carResults, ...marineResults].filter(r => {
        if (seenIds.has(r.id)) return false;
        seenIds.add(r.id);
        return true;
      });
      results.sort((a, b) => a.distance - b.distance);
      setGarages(results);
    } catch (err) { console.error('Overpass fetch error:', err); setGarages([]); }
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

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4" dir="rtl">
        <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: C.light }}>
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: C.primary }} />
        </div>
        <p className="text-lg font-medium" style={{ color: C.text }}>מאתר את המיקום שלך...</p>
      </div>
    );
  }

  // ── Error / city search ──
  if (locError && !userLocation) {
    return (
      <div className="flex flex-col items-center min-h-[60vh] gap-5 px-4 pt-8" dir="rtl">
        <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: C.light }}>
          <MapPinOff className="w-7 h-7" style={{ color: C.primary }} />
        </div>
        <div className="text-center">
          <p className="text-lg font-bold" style={{ color: C.text }}>חפש מוסך לפי עיר</p>
          <p className="text-sm mt-1" style={{ color: C.muted }}>הזן שם עיר או כתובת למציאת מוסכים בסביבה</p>
        </div>
        <div className="w-full max-w-sm">
          <div className="flex gap-2">
            <input value={cityQuery} onChange={e => setCityQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') searchByCity(cityQuery); }}
              placeholder="הזן עיר או כתובת..." dir="rtl"
              className="flex-1 h-12 px-4 rounded-2xl text-sm font-medium"
              style={{ background: '#fff', border: `1.5px solid ${C.border}` }} />
            <button onClick={() => searchByCity(cityQuery)} disabled={searchingCity || !cityQuery.trim()}
              className="h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 disabled:opacity-50"
              style={{ background: C.primary, color: '#fff' }}>
              {searchingCity ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
            </button>
          </div>
        </div>
        <div className="w-full max-w-sm">
          <p className="text-xs font-bold mb-2" style={{ color: C.muted }}>או בחר עיר:</p>
          <div className="flex flex-wrap gap-2">
            {QUICK_CITIES.map(city => (
              <button key={city.name}
                onClick={() => { setLocError(null); setUserLocation({ lat: city.lat, lng: city.lng }); }}
                className="px-4 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-[0.97]"
                style={{ background: C.yellow, color: C.text }}>{city.name}</button>
            ))}
          </div>
        </div>
        <button onClick={() => { setLoading(true); setLocError(null); navigator.geolocation.getCurrentPosition(
          (pos) => { setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLoading(false); },
          () => { setLocError('גישה חסומה.'); setLoading(false); },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }); }}
          className="text-xs underline" style={{ color: C.muted }}>נסה שוב עם GPS</button>
      </div>
    );
  }

  // ── Main view ──
  return (
    <div className="-mx-4 lg:-mx-8 -mt-4 lg:-mt-8" dir="rtl">
      {/* Hero header */}
      <div className="px-5 pt-5 pb-4" style={{ background: C.grad }}>
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.15)' }}>
              <MapPin className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">{hasVessel ? 'מצא מוסך / מרינה' : 'מצא מוסך קרוב'}</h1>
              <p className="text-xs text-white/70">
                {hasVessel ? 'מוסכים, פנצ\'ריות, חלפים, מרינות ושירותי שייט' : 'מוסכים, פנצ\'ריות, מכונאים וחנויות חלפים'}
              </p>
            </div>
          </div>

          {/* Radius + Sort */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/70">רדיוס:</span>
              <div className="flex gap-1.5">
                {RADIUS_OPTIONS.map(opt => (
                  <button key={opt.value} onClick={() => setSearchRadius(opt.value)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                    style={{ background: searchRadius === opt.value ? C.yellow : 'rgba(255,255,255,0.15)', color: searchRadius === opt.value ? C.text : '#fff' }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-white/70">מיון:</span>
              <button onClick={() => setSortBy(s => s === 'distance' ? 'name' : 'distance')}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold"
                style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}>
                <ArrowUpDown className="w-3 h-3" />
                {sortBy === 'distance' ? 'מרחק' : 'שם'}
              </button>
            </div>
          </div>
          {fetching && <Loader2 className="w-4 h-4 animate-spin text-white/70 mt-2" />}
        </div>
      </div>

      {/* Type filter pills */}
      <div className="px-4 -mt-2 mb-2 relative z-10">
        <div className="max-w-5xl mx-auto flex gap-2 overflow-x-auto py-2 scrollbar-hide">
          {[
            { key: 'all', label: 'הכל', color: C.primary, bg: C.light },
            ...Object.entries(TYPE_CONFIG).map(([key, val]) => ({ key, label: val.label, color: val.color, bg: val.bg })),
            ...(hasVessel ? Object.entries(MARINE_TYPE_CONFIG).map(([key, val]) => ({ key, label: val.label, color: val.color, bg: val.bg })) : []),
          ].map(f => (
            <button key={f.key} onClick={() => setFilterType(f.key)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold shrink-0 transition-all"
              style={{
                background: filterType === f.key ? f.color : f.bg,
                color: filterType === f.key ? '#fff' : f.color,
                border: `1.5px solid ${filterType === f.key ? f.color : f.color + '40'}`,
                boxShadow: filterType === f.key ? `0 2px 8px ${f.color}40` : 'none',
              }}>
              {f.label}
              {typeCounts[f.key] > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black"
                  style={{ background: filterType === f.key ? 'rgba(255,255,255,0.3)' : f.color + '20', color: filterType === f.key ? '#fff' : f.color }}>
                  {typeCounts[f.key]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Name search */}
      <div className="px-4 mb-3">
        <div className="max-w-5xl mx-auto">
          <div className="relative">
            <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: C.muted }} />
            <input
              value={nameQuery}
              onChange={e => setNameQuery(e.target.value)}
              placeholder="חפש מוסך לפי שם..."
              dir="rtl"
              className="w-full h-11 pr-10 pl-4 rounded-xl text-sm font-medium outline-none transition-all"
              style={{ background: '#fff', border: `1.5px solid ${C.border}`, color: C.text }}
              onFocus={e => e.target.style.borderColor = C.primary}
              onBlur={e => e.target.style.borderColor = C.border}
            />
            {nameQuery && (
              <button onClick={() => setNameQuery('')}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center"
                style={{ background: C.border, color: C.muted }}>
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Map */}
      <div className="px-4">
        <div className="max-w-5xl mx-auto">
          <div className="rounded-2xl overflow-hidden shadow-lg border" style={{ borderColor: C.border, height: '50vh', minHeight: '300px' }}>
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
                            className="flex-1 text-xs text-white rounded-lg px-2 py-1.5 font-medium"
                            style={{ background: C.primary }}>Google Maps</button>
                          <button onClick={() => openWazeNav(g.lat, g.lon)}
                            className="flex-1 text-xs text-white rounded-lg px-2 py-1.5 font-medium"
                            style={{ background: '#33CCFF' }}>Waze</button>
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                  );
                })}
              </MapContainer>
            )}
          </div>
        </div>
      </div>

      {/* Results header */}
      <div className="px-4 mt-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <p className="text-sm font-bold" style={{ color: C.text }}>
            {fetching ? 'מחפש...' : displayGarages.length > 0 ? `נמצאו ${displayGarages.length} תוצאות` : 'לא נמצאו תוצאות'}
          </p>
          <span className="text-[11px] font-medium px-2.5 py-1 rounded-full"
            style={{ background: C.light, color: C.primary }}>
            {sortBy === 'distance' ? 'לפי מרחק' : 'לפי שם'}
          </span>
        </div>
      </div>

      {/* Legend */}
      <div className="px-4 mt-2">
        <div className="max-w-5xl mx-auto flex gap-3 flex-wrap">
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
      <div className="px-4 mt-3 pb-8">
        <div className="max-w-5xl mx-auto space-y-3">
          {!fetching && displayGarages.length === 0 && (
            <div className="text-center py-12 rounded-2xl border" style={{ background: C.light, borderColor: C.border }}>
              <Search className="w-10 h-10 mx-auto mb-3" style={{ color: C.muted }} />
              <p className="font-medium" style={{ color: C.text }}>לא נמצאו תוצאות</p>
              <p className="text-sm mt-1" style={{ color: C.muted }}>נסה להגדיל רדיוס או לשנות סינון</p>
            </div>
          )}

          {displayGarages.map(g => {
            const tc = ALL_TYPE_CONFIG[g.typeKey] || TYPE_CONFIG.garage;
            const isSelected = selectedGarage === g.id;
            return (
              <div key={g.id} id={`garage-card-${g.id}`}
                className="rounded-2xl border p-4 transition-all duration-200"
                style={{
                  background: '#fff',
                  borderColor: isSelected ? tc.color : C.border,
                  borderWidth: isSelected ? '2px' : '1.5px',
                  boxShadow: isSelected ? `0 0 0 3px ${tc.color}15, 0 4px 16px rgba(0,0,0,0.1)` : '0 1px 4px rgba(0,0,0,0.04)',
                }}
                onClick={() => setSelectedGarage(g.id)}>
                <div className="flex items-start gap-3">
                  {/* Type icon */}
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: tc.bg, border: `1.5px solid ${tc.border}` }}>
                    <div dangerouslySetInnerHTML={{ __html: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${tc.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${tc.svg}</svg>` }} />
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Name + type badge + distance */}
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="min-w-0">
                        <h3 className="font-black text-sm truncate" style={{ color: C.text }}>{g.name}</h3>
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full inline-block mt-0.5"
                          style={{ background: tc.bg, color: tc.color, border: `1px solid ${tc.border}` }}>
                          {tc.label}
                        </span>
                      </div>
                      <span className="text-xs font-black px-2.5 py-1 rounded-full shrink-0"
                        style={{ background: `linear-gradient(135deg, ${tc.bg}, ${tc.border}40)`, color: tc.color }}>
                        {g.distance.toFixed(1)} ק"מ
                      </span>
                    </div>

                    {/* Address */}
                    {g.address && (
                      <p className="text-xs mt-1.5 flex items-center gap-1" style={{ color: C.muted }}>
                        <MapPin className="w-3.5 h-3.5 shrink-0" />{g.address}
                      </p>
                    )}

                    {/* Phone */}
                    {g.phone && (
                      <a href={`tel:${g.phone}`} className="text-xs mt-1 inline-flex items-center gap-1 font-medium" style={{ color: tc.color }}>
                        <Phone className="w-3 h-3" />{g.phone}
                      </a>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-2 mt-3 flex-wrap">
                      <button onClick={e => { e.stopPropagation(); openGoogleNav(g.lat, g.lon); }}
                        className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-white transition-all active:scale-[0.97]"
                        style={{ background: '#4285F4', boxShadow: '0 2px 8px rgba(66,133,244,0.35)' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 010-5 2.5 2.5 0 010 5z"/></svg>
                        Google Maps
                      </button>
                      <button onClick={e => { e.stopPropagation(); openWazeNav(g.lat, g.lon); }}
                        className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-white transition-all active:scale-[0.97]"
                        style={{ background: '#33CCFF', boxShadow: '0 2px 8px rgba(51,204,255,0.35)' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12c0 2.76 1.12 5.26 2.93 7.07L12 22l7.07-2.93A9.96 9.96 0 0022 12c0-5.52-4.48-10-10-10zm-2 14a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm4 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm2.5-5.5c-.28 0-.5-.22-.5-.5V9c0-2.21-1.79-4-4-4S8 6.79 8 9v1c0 .28-.22.5-.5.5S7 10.28 7 10V9c0-2.76 2.24-5 5-5s5 2.24 5 5v1c0 .28-.22.5-.5.5z"/></svg>
                        Waze
                      </button>
                      <button onClick={e => { e.stopPropagation(); openGoogleSearch(g.name, g.lat, g.lon); }}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all active:scale-[0.97]"
                        style={{ background: '#F5F5F5', color: '#666', border: '1px solid #E0E0E0' }}>
                        <Star className="w-3.5 h-3.5" style={{ color: '#FBBC04' }} />דירוגים
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
