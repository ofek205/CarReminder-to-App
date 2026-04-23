import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { createPageUrl } from "@/utils";
import { supabase } from '@/lib/supabase';
import { Car, Ship, LayoutDashboard, Bell, Settings, Users, User, FileText, Menu, X, LogOut, Wrench, Star, UserCircle, CheckCircle, AlertTriangle, XCircle, Phone, Mail, CreditCard, UserPlus, ShieldCheck, MapPin, Gauge, MessageSquare, Sparkles, ChevronLeft } from 'lucide-react';
import logo from '@/assets/logo.png';
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FontScaleProvider } from "@/components/shared/FontScaleProvider";
import FontScaleControls from "@/components/shared/FontScaleControls";
import WelcomePopup from "@/components/shared/WelcomePopup";
import GuestWelcomePopup from "@/components/shared/GuestWelcomePopup";
import MileageReminderPopup, { shouldShowMileageReminder } from "@/components/shared/MileageReminderPopup";
import ReviewManager from "@/components/shared/ReviewManager";
import ReviewPopup from "@/components/shared/ReviewPopup";
import useReviewPromptSchedule from "@/hooks/useReviewPromptSchedule";
import PopupEngine from "@/components/shared/PopupEngine";
import { SafeComponent } from "@/components/shared/SafeComponent";
import { GuestProvider, useAuth } from "@/components/shared/GuestContext";
import { format, parseISO } from 'date-fns';
import { AccessibilityProvider } from "@/components/shared/AccessibilityContext";
import AccessibilityPanel from "@/components/shared/AccessibilityPanel";
import BottomNav from "@/components/shared/BottomNav";

// Bottom nav paths (duplicated in mobile sidebar. hide from sidebar on mobile)
const BOTTOM_NAV_PATHS = new Set(['Dashboard', 'Documents', 'FindGarage', 'Accidents', 'AiAssistant']);

const navItems = [
  //  ניווט 
  { name: 'Dashboard',             label: 'דף הבית שלי',     icon: LayoutDashboard, guestAllowed: true },
  { name: 'Vehicles',              label: 'רכבים',            icon: Car,             guestAllowed: true },
  { name: 'Vehicles?category=vessel', label: 'כלי שייט',      icon: Ship,            guestAllowed: true, vesselOnly: true },
  //  ניהול 
  { divider: true, title: 'ניהול' },
  { name: 'MaintenanceTemplates',  label: 'טיפולים ותיקונים', icon: Wrench,          guestAllowed: true },
  { name: 'Documents',             label: 'מסמכים',           icon: FileText,        guestAllowed: true },
  { name: 'Accidents',             label: 'תאונות',           icon: AlertTriangle,   guestAllowed: true },
  //  קהילה 
  { divider: true, title: 'קהילה' },
  { name: 'Community',             label: 'קהילה וייעוץ',    icon: Users,           guestAllowed: true },
  { name: 'AiAssistant',           label: 'התייעצות עם מומחה AI', icon: Sparkles,    guestAllowed: true },
  //  כלים 
  { divider: true, title: 'כלים' },
  { name: 'FindGarage',            label: 'מצא מוסך',        icon: MapPin,          guestAllowed: true },
  //  חשבון 
  { divider: true, title: 'חשבון' },
  // Unified Settings hub replaces three separate entries (אזור אישי /
  // שיתוף חשבון / הגדרות תזכורות). The old routes still work as
  // deep-link targets (e.g. from push notifications), they just aren't
  // surfaced in the menu any more.
  { name: 'Settings',              label: 'הגדרות',           icon: Settings,        guestAllowed: true },
  { name: 'AdminReviews',          label: 'חוות דעת',         icon: Star,            guestAllowed: true },
  { name: 'Contact',               label: 'צור קשר',          icon: MessageSquare,   guestAllowed: true },
  { name: 'AdminDashboard',        label: 'לוח ניהול',        icon: ShieldCheck,     guestAllowed: false, adminOnly: true },
  { name: 'EmailCenter',           label: 'ניהול מיילים',      icon: Mail,            guestAllowed: false, adminOnly: true },
];


function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function isBirthdayToday(birthDate) {
  if (!birthDate) return false;
  const today = new Date();
  const bd = new Date(birthDate);
  return today.getMonth() === bd.getMonth() && today.getDate() === bd.getDate();
}

function GuestBanner() {
  const navigate = useNavigate();
  return (
    <div className="flex items-center gap-2 px-3 py-1" dir="rtl"
      style={{ background: 'linear-gradient(135deg, #2D5233, #3A6B42)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
      <p className="text-[10px] font-medium text-white/70 flex-1 truncate">מצב אורח</p>
      <Link
        to={createPageUrl('Auth')}
        className="text-[11px] font-bold text-white/80 underline underline-offset-2 hover:text-white transition-colors py-2 px-2 touch-manipulation shrink-0"
      >
        יש לי חשבון
      </Link>
      <Button onClick={() => navigate(createPageUrl('Auth'))}
        className="text-[11px] font-bold h-8 px-3 gap-1 rounded-full touch-manipulation shrink-0"
        style={{ background: '#FFBF00', color: '#2D5233' }}>
        <UserPlus className="h-3.5 w-3.5" />
        הירשם
      </Button>
    </div>
  );
}

function UserPopover() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  const handleLogout = async () => {
    // Clear personal data from localStorage on logout (privacy)
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith('yossi_chat_history') || k === 'read_notif_ids' || k === 'read_notif_timed' || k === 'dismissed_notif_ids')
        .forEach(k => localStorage.removeItem(k));
    } catch {}
    await supabase.auth.signOut();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          title="פתח אזור אישי"
          className="flex items-center gap-3 cursor-pointer group rounded-xl px-1 py-1 transition-all duration-200 hover:bg-[#E8F2EA]"
        >
          <img src={logo} alt="CarReminder" className="w-8 h-8 rounded-lg object-cover shadow-sm transition-transform duration-200 group-hover:scale-105" />
          <div>
            <h1 className="text-gray-900 mx-2 text-sm font-bold leading-tight group-hover:text-[#2D5233] transition-colors duration-200">ניהול כלי תחבורה</h1>
            <p className="text-slate-500 mx-2 text-[10px]">פתח אזור אישי</p>
          </div>
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0 shadow-lg" dir="rtl">
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#E8F2EA] flex items-center justify-center shrink-0">
              <UserCircle className="h-5 w-5 text-[#2D5233]" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 text-sm truncate">{user?.full_name || '...'}</p>
              <p className="text-xs text-gray-500 truncate">{user?.email}</p>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-3 flex gap-2">
            <Link to={createPageUrl('UserProfile')} onClick={() => setOpen(false)} className="flex-1">
              <Button size="sm" className="w-full bg-[#2D5233] hover:bg-[#1E3D24] text-white text-xs h-8">
                אזור אישי
              </Button>
            </Link>
            <Button size="sm" variant="outline" onClick={handleLogout} className="text-xs h-8 text-gray-600">
              התנתקות
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NavContent({ currentPath, onItemClick, hasVessel, isMobile = false }) {
  const { isAuthenticated, isGuest, user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin' || user?.email === 'ofek205@gmail.com';
  // On mobile, hide items that are already in the bottom nav
  const visibleItems = navItems.filter(item =>
    item.divider || (
      (isAuthenticated || item.guestAllowed) &&
      (!item.adminOnly || isAdmin) &&
      (!item.vesselOnly || hasVessel) &&
      (!isMobile || !BOTTOM_NAV_PATHS.has(item.name))
    )
  // Remove dividers that have no items after them (orphan dividers)
  ).filter((item, i, arr) => {
    if (!item.divider) return true;
    // Keep divider only if there's a non-divider item after it before the next divider
    for (let j = i + 1; j < arr.length; j++) {
      if (arr[j].divider) return false;
      return true;
    }
    return false;
  });

  const handleLogout = async () => {
    // Clear personal data from localStorage on logout (privacy)
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith('yossi_chat_history') || k === 'read_notif_ids' || k === 'read_notif_timed' || k === 'dismissed_notif_ids')
        .forEach(k => localStorage.removeItem(k));
    } catch {}
    await supabase.auth.signOut();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 pt-12 border-b border-gray-100 shrink-0">
        {isAuthenticated ? (
          <Link to={createPageUrl('Settings') + '?tab=profile'} onClick={onItemClick}
            className="flex items-center gap-3 rounded-xl -m-2 p-2 transition-colors hover:bg-gray-50 active:bg-gray-100"
            aria-label="הגדרות ופרופיל">
            <div className="w-9 h-9 rounded-xl bg-[#E8F2EA] flex items-center justify-center shrink-0">
              <User className="h-5 w-5 text-[#2D5233]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-gray-900 truncate">{user?.full_name || 'ניהול כלי תחבורה'}</p>
              <p className="text-[10px] text-gray-400 truncate">{user?.email || ''}</p>
            </div>
            <ChevronLeft className="h-4 w-4 text-gray-400 shrink-0" aria-hidden="true" />
          </Link>
        ) : (
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
              <User className="h-5 w-5 text-gray-400" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-gray-900">מצב אורח</h1>
              <p className="text-[10px] text-gray-400">הירשם כדי לשמור נתונים</p>
            </div>
          </div>
        )}
      </div>

      {/* Navigation - scrollable */}
      <nav className={`flex-1 overflow-y-auto p-2 space-y-0.5 ${isMobile ? 'pb-4' : ''}`} dir="rtl">
        {visibleItems.map((item, i) => {
          if (item.divider) {
            return (
              <div key={`div-${i}`} className="pt-3 pb-1 px-3">
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#B0B8C1' }}>{item.title}</p>
              </div>
            );
          }
          const itemUrl = item.name.includes('?') ? `/${item.name}` : createPageUrl(item.name);
          const currentSearch = window.location.search || '';
          let isActive;
          if (item.vesselOnly) {
            isActive = currentPath.includes('/Vehicles') && currentSearch.includes('category=vessel');
          } else if (item.name === 'Vehicles') {
            isActive = currentPath.includes('/Vehicles') && !currentSearch.includes('category=vessel');
          } else {
            isActive = currentPath.includes(createPageUrl(item.name));
          }
          return (
            <Link
              key={item.name}
              to={itemUrl}
              onClick={onItemClick}
              className={`flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-medium transition-all duration-150
                ${isActive ?
              'bg-[#E8F2EA] text-[#2D5233]' :
              'text-gray-600 active:bg-gray-50'}`
              }>
              <item.icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? 'text-[#2D5233]' : 'text-gray-400'}`} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className={`p-3 border-t border-gray-100 space-y-1.5 shrink-0 ${isMobile ? 'pb-20' : ''}`} dir="rtl">
        {isAuthenticated ? (
          <button
            onClick={handleLogout}
            className="px-3 py-2 text-[13px] font-medium rounded-xl flex items-center gap-3 text-gray-500 hover:bg-gray-50 w-full transition-all">
            <LogOut className="h-4 w-4 text-gray-400" />
            התנתקות
          </button>
        ) : (
          <button
            onClick={() => navigate(createPageUrl('Auth'))}
            className="bg-[#2D5233] text-white px-3 py-2 text-[13px] font-medium rounded-xl flex items-center gap-3 hover:bg-[#1E3D24] w-full transition-all">
            <UserPlus className="h-4 w-4" />
            הירשם / התחבר
          </button>
        )}
      </div>
    </div>
  );
}

function DraggableA11yButton({ onClick }) {
  const [pos, setPos] = useState({ x: 20, y: window.innerHeight - 160 });
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });
  const moved = useRef(false);

  const clamp = (x, y) => ({
    x: Math.max(0, Math.min(window.innerWidth - 40, x)),
    y: Math.max(0, Math.min(window.innerHeight - 120, y)),
  });

  const startDrag = (clientX, clientY) => {
    dragging.current = true;
    moved.current = false;
    offset.current = { x: clientX - pos.x, y: clientY - pos.y };
  };

  const moveDrag = (clientX, clientY) => {
    if (!dragging.current) return;
    moved.current = true;
    setPos(clamp(clientX - offset.current.x, clientY - offset.current.y));
  };

  const endDrag = () => { dragging.current = false; };

  useEffect(() => {
    // Mouse events (desktop)
    const onMouseMove = (e) => moveDrag(e.clientX, e.clientY);
    const onMouseUp = endDrag;
    // Touch events (mobile)
    const onTouchMove = (e) => {
      if (!dragging.current) return;
      e.preventDefault();
      const t = e.touches[0];
      moveDrag(t.clientX, t.clientY);
    };
    const onTouchEnd = endDrag;

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); startDrag(e.clientX, e.clientY); }}
      onTouchStart={(e) => { const t = e.touches[0]; startDrag(t.clientX, t.clientY); }}
      onClick={() => { if (!moved.current) onClick(); }}
      aria-label="פתח הגדרות נגישות"
      style={{ left: pos.x, top: pos.y, position: 'fixed', cursor: 'grab', touchAction: 'none' }}
      className="z-50 text-3xl leading-none select-none focus-visible:outline-none"
    >
      ♿
    </button>
  );
}

//  Notification Bell with dropdown (authenticated users only) 
function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [readIds, setReadIds] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('read_notif_ids') || '[]');
      // Check timed reads. remove expired ones (older than 7 days)
      const timedReads = JSON.parse(localStorage.getItem('read_notif_timed') || '{}');
      const now = Date.now();
      const validTimedIds = Object.entries(timedReads)
        .filter(([_, ts]) => now - ts < 7 * 24 * 60 * 60 * 1000)
        .map(([id]) => id);
      return new Set([...stored, ...validTimedIds]);
    } catch { return new Set(); }
  });
  const [popupOpen, setPopupOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const { user } = useAuth();
  const navigate = useNavigate();

  // Listen for profile updates to refresh notifications
  useEffect(() => {
    const handler = () => setRefreshKey(k => k + 1);
    window.addEventListener('userProfileUpdated', handler);
    window.addEventListener('profileSaved', handler);
    return () => {
      window.removeEventListener('userProfileUpdated', handler);
      window.removeEventListener('profileSaved', handler);
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { db } = await import('@/lib/supabaseEntities');

        // Parallelize 3 independent queries: profile, members, settings
        const [profilesResult, membersResult, settingsResult] = await Promise.all([
          db.user_profiles.filter({ user_id: user.id }).catch(() => []),
          db.account_members.filter({ user_id: user.id, status: 'פעיל' }).catch(() => []),
          db.reminder_settings.filter({ user_id: user.id }).catch(() => []),
        ]);

        // Build profile notifications
        const profileNotifs = [];
        const profile = profilesResult.length > 0 ? profilesResult[0] : null;
        if (!profile || !profile.phone) {
          profileNotifs.push({
            id: 'profile-incomplete',
            vehicleId: null,
            type: 'profile',
            label: 'השלם פרטים אישיים',
            name: 'הוסף טלפון ותאריך לידה באזור האישי',
            days: -999,
            isExpired: false,
          });
        }
        if (profile?.license_expiration_date) {
          const licDays = Math.ceil((new Date(profile.license_expiration_date) - new Date()) / 86400000);
          if (licDays <= 30) {
            profileNotifs.push({
              id: 'license-expiry',
              vehicleId: null,
              type: 'license',
              label: licDays < 0 ? 'רישיון נהיגה פג תוקף!' : `רישיון נהיגה בעוד ${licDays} ימים`,
              name: 'עדכן באזור האישי',
              days: licDays,
              isExpired: licDays < 0,
            });
          }
        }

        // Set profile-level notifications immediately
        setNotifications(prev => {
          const withoutProfile = prev.filter(n => n.id !== 'profile-incomplete' && n.id !== 'license-expiry');
          return [...profileNotifs, ...withoutProfile];
        });

        if (membersResult.length === 0) return;
        const vehicles = await db.vehicles.filter({ account_id: membersResult[0].account_id });

        // Reminder threshold (default 14)
        const threshold = (settingsResult.length > 0 && settingsResult[0].remind_test_days_before) || 14;

        // Cache localStorage parse ONCE before vehicle loop (instead of per-vehicle)
        let mileageDates = {};
        try { mileageDates = JSON.parse(localStorage.getItem('carreminder_mileage_dates') || '{}'); } catch {}

        const items = [];
        const now = new Date();
        const isVesselVeh = (v) => ['כלי שייט','מפרשית','סירה מנועית','אופנוע ים','סירת גומי'].includes(v.vehicle_type);

        const addNotif = (id, vehicleId, type, label, name, days, navTarget) => {
          items.push({ id, vehicleId, type, label, name, days, isExpired: days < 0, navTarget });
        };

        const daysTo = (dateStr) => dateStr ? Math.ceil((new Date(dateStr) - now) / 86400000) : null;

        vehicles.forEach(v => {
          const name = v.nickname || v.manufacturer || 'רכב';
          const isVessel = isVesselVeh(v);
          const testWord = isVessel ? 'כושר שייט' : 'טסט';

          // 1. טסט / כושר שייט
          // רכב אספנות = is_vintage OR year >= 30 years old (regardless of category)
          const vehicleAge = v.year ? now.getFullYear() - Number(v.year) : 0;
          // כל כלי רכב מעל 30 שנה = אספנות (רכב, אופנוע, משאית, כל דבר חוץ מכלי שייט)
          const isVintage = !isVessel && (v.is_vintage || vehicleAge >= 30 || v.vehicle_type === 'רכב אספנות');

          if (v.test_due_date) {
            let nextTestDate = new Date(v.test_due_date);
            // רכב אספנות: טסט כל 6 חודשים. אם תאריך הטסט הבא רחוק, חשב חצי שנה
            if (isVintage) {
              const sixMonthsFromTest = new Date(v.test_due_date);
              sixMonthsFromTest.setMonth(sixMonthsFromTest.getMonth() - 6);
              // If the test_due_date is more than 6 months away, the real next test is 6 months before
              if (nextTestDate > now) {
                const halfTest = new Date(nextTestDate);
                halfTest.setMonth(halfTest.getMonth() - 6);
                if (halfTest > now) {
                  // Both are in the future. use the closer one (half)
                  nextTestDate = halfTest;
                }
              }
            }
            const testDays = Math.ceil((nextTestDate - now) / 86400000);
            const vintageLabel = isVintage ? ' (אספנות)' : '';
            if (testDays <= threshold) {
              addNotif(`test-${v.id}`, v.id, 'test',
                testDays < 0 ? `${testWord} פג תוקף!${vintageLabel}` : `${testWord} בעוד ${testDays} ימים${vintageLabel}`,
                name, testDays, 'VehicleDetail');
            }
          }

          // 2. ביטוח
          const insDays = daysTo(v.insurance_due_date);
          if (insDays !== null && insDays <= threshold) {
            addNotif(`ins-${v.id}`, v.id, 'insurance',
              insDays < 0 ? 'ביטוח פג תוקף!' : `ביטוח בעוד ${insDays} ימים`,
              name, insDays, 'VehicleDetail');
          }

          // 3. ציוד בטיחות. כלי שייט בלבד
          if (isVessel) {
            const pyroDays = daysTo(v.pyrotechnics_expiry_date);
            if (pyroDays !== null && pyroDays <= threshold) {
              addNotif(`pyro-${v.id}`, v.id, 'safety',
                pyroDays < 0 ? 'פירוטכניקה פג תוקף!' : `פירוטכניקה בעוד ${pyroDays} ימים`,
                name, pyroDays, 'VehicleDetail');
            }
            const extDays = daysTo(v.fire_extinguisher_expiry_date);
            if (extDays !== null && extDays <= threshold) {
              addNotif(`ext-${v.id}`, v.id, 'safety',
                extDays < 0 ? 'מטף כיבוי פג תוקף!' : `מטף כיבוי בעוד ${extDays} ימים`,
                name, extDays, 'VehicleDetail');
            }
            const raftDays = daysTo(v.life_raft_expiry_date);
            if (raftDays !== null && raftDays <= threshold) {
              addNotif(`raft-${v.id}`, v.id, 'safety',
                raftDays < 0 ? 'אסדת הצלה פג תוקף!' : `אסדת הצלה בעוד ${raftDays} ימים`,
                name, raftDays, 'VehicleDetail');
            }
          }

          // 4. החלפת צמיגים. כל 100,000 ק"מ או 3 שנים
          if (!isVessel && v.current_km && v.last_tire_change_date) {
            const kmSinceTire = v.current_km - (v.km_since_tire_change ? (v.current_km - Number(v.km_since_tire_change)) : 0);
            const tireDaysAgo = Math.floor((now - new Date(v.last_tire_change_date)) / 86400000);
            const tireYears = tireDaysAgo / 365;
            if (kmSinceTire >= 90000 || tireYears >= 2.75) {
              const urgent = kmSinceTire >= 100000 || tireYears >= 3;
              addNotif(`tires-${v.id}`, v.id, 'maintenance',
                urgent ? 'הגיע זמן להחליף צמיגים!' : 'החלפת צמיגים מתקרבת',
                name, urgent ? 0 : 30, 'VehicleDetail');
            }
          }

          // 5. טיפול תקופתי. כל 15,000 ק"מ או שנה מהטיפול האחרון
          if (!isVessel && v.current_km) {
            // Check last maintenance from maintenance_logs or km_baseline
            const lastServiceKm = v.km_baseline || 0;
            const kmSinceService = v.current_km - lastServiceKm;
            if (kmSinceService >= 13500) {
              const urgent = kmSinceService >= 15000;
              addNotif(`service-${v.id}`, v.id, 'maintenance',
                urgent ? `טיפול תקופתי נדרש (${Math.round(kmSinceService / 1000)}K ק"מ)` : `טיפול מתקרב (${Math.round(kmSinceService / 1000)}K ק"מ)`,
                name, urgent ? 0 : 30, 'VehicleDetail');
            }
          }

          // 6. מספנה. כלי שייט, כל 3 שנים מהפעם הקודמת
          if (isVessel && v.last_shipyard_date) {
            const shipyardDaysAgo = Math.floor((now - new Date(v.last_shipyard_date)) / 86400000);
            const shipyardYears = shipyardDaysAgo / 365;
            if (shipyardYears >= 2.75) {
              const urgent = shipyardYears >= 3;
              addNotif(`shipyard-${v.id}`, v.id, 'maintenance',
                urgent ? 'הגיע זמן לביקור מספנה!' : 'ביקור מספנה מתקרב',
                name, urgent ? 0 : 30, 'VehicleDetail');
            }
          }

          // 7. רכב מעל 15 שנה. נדרש אישור בלמים לפני טסט
          if (!isVessel && vehicleAge >= 15 && v.test_due_date) {
            const testDaysLeft = daysTo(v.test_due_date);
            if (testDaysLeft !== null && testDaysLeft <= 60 && testDaysLeft > 0) {
              addNotif(`brakes-${v.id}`, v.id, 'safety',
                `רכב ותיק (${vehicleAge} שנים): נדרש אישור בלמים לטסט`,
                name, testDaysLeft, 'VehicleDetail');
            }
          }

          // 8. עדכון ק"מ / שעות מנוע. לא עודכן חצי שנה
          const localMileageDate = mileageDates[v.id] || null;
          const mileageDate = localMileageDate || v.km_update_date || v.engine_hours_update_date;
          if (mileageDate) {
            const mileageDays = Math.floor((now - new Date(mileageDate)) / 86400000);
            if (mileageDays > 180) {
              const isKmVehicle = !isVessel;
              addNotif(`mileage-${v.id}`, v.id, 'mileage',
                isKmVehicle ? `עדכן קילומטראז' (${mileageDays} ימים)` : `עדכן שעות מנוע (${mileageDays} ימים)`,
                name, 999, 'VehicleDetail');
            }
          } else if (v.current_km || v.current_engine_hours) {
            // Has mileage but no update date. probably old, remind
            addNotif(`mileage-${v.id}`, v.id, 'mileage',
              !isVessel ? 'עדכן קילומטראז\'' : 'עדכן שעות מנוע',
              name, 999, 'VehicleDetail');
          }
        });

        // 9. הכן את הרכב לחורף. נובמבר
        const month = now.getMonth(); // 0-indexed: 10=November
        const hasNonVesselVehicles = vehicles.some(v => !isVesselVeh(v));
        const hasVesselVehicles = vehicles.some(v => isVesselVeh(v));

        if (month === 10 && hasNonVesselVehicles) { // November
          const winterKey = `winter_dismissed_${now.getFullYear()}`;
          if (!localStorage.getItem(winterKey)) {
            items.push({
              id: 'winter-prep',
              vehicleId: null,
              type: 'seasonal',
              label: '❄️ הכן את הרכב לחורף',
              name: 'בדוק: סוללה, מגבים, צמיגים, מים למגבים, אורות',
              days: 500,
              isExpired: false,
            });
          }
        }

        // 10. עונת הפלגה. אפריל
        if (month === 3 && hasVesselVehicles) { // April
          const sailKey = `sailing_dismissed_${now.getFullYear()}`;
          if (!localStorage.getItem(sailKey)) {
            items.push({
              id: 'sailing-season',
              vehicleId: null,
              type: 'seasonal',
              label: '⛵ עונת ההפלגה מתחילה!',
              name: 'בדוק: ציוד בטיחות, מנוע, תחתית, מפרשים',
              days: 500,
              isExpired: false,
            });
          }
        }

        // Sort: expired first (negative days), then by days ascending
        items.sort((a, b) => {
          if (a.isExpired && !b.isExpired) return -1;
          if (!a.isExpired && b.isExpired) return 1;
          return a.days - b.days;
        });

        // Fetch community notifications (someone replied to your post)
        try {
          const { data: communityNotifs, error: cnError } = await supabase
            .from('community_notifications')
            .select('*')
            .eq('user_id', user.id)
            .eq('is_read', false)
            .order('created_at', { ascending: false })
            .limit(10);
          if (!cnError && communityNotifs) communityNotifs.forEach(cn => {
            items.push({
              id: `community-${cn.id}`,
              vehicleId: null,
              type: 'community',
              label: `${cn.commenter_name} הגיב/ה על השאלה שלך`,
              name: 'לחץ לצפייה',
              days: 500,
              isExpired: false,
              navTarget: 'Community',
              _communityNotifId: cn.id,
            });
          });
        } catch {}

        // Filter out dismissed notifications
        let dismissedIds = [];
        try { dismissedIds = JSON.parse(localStorage.getItem('dismissed_notif_ids') || '[]'); } catch {}
        const dismissedSet = new Set(dismissedIds);

        setNotifications(prev => {
          const profileNotifs = prev.filter(n => n.id === 'profile-incomplete' || n.id === 'license-expiry');
          const filtered = [...profileNotifs, ...items].filter(n => !dismissedSet.has(n.id));
          return filtered;
        });
      } catch {}
    })();
  }, [user, refreshKey]);

  const unreadCount = notifications.filter(n => !readIds.has(n.id)).length;

  const markRead = (id) => {
    setReadIds(prev => {
      const next = new Set(prev);
      next.add(id);
      // Profile notification uses timed read (reappears after 7 days)
      if (id === 'profile-incomplete') {
        try {
          const timed = JSON.parse(localStorage.getItem('read_notif_timed') || '{}');
          timed[id] = Date.now();
          localStorage.setItem('read_notif_timed', JSON.stringify(timed));
        } catch {}
      } else {
        // Regular notifications stay permanently read
        const permanentIds = [...next].filter(i => i !== 'profile-incomplete');
        localStorage.setItem('read_notif_ids', JSON.stringify(permanentIds));
      }
      return next;
    });
  };

  const markUnread = (id) => {
    setReadIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      if (id === 'profile-incomplete') {
        try {
          const timed = JSON.parse(localStorage.getItem('read_notif_timed') || '{}');
          delete timed[id];
          localStorage.setItem('read_notif_timed', JSON.stringify(timed));
        } catch {}
      } else {
        localStorage.setItem('read_notif_ids', JSON.stringify([...next].filter(i => i !== 'profile-incomplete')));
      }
      return next;
    });
  };

  const dismissNotification = (id) => {
    // Remove from visible list + save to localStorage so it doesn't come back
    setNotifications(prev => prev.filter(n => n.id !== id));
    try {
      const dismissed = JSON.parse(localStorage.getItem('dismissed_notif_ids') || '[]');
      if (!dismissed.includes(id)) {
        dismissed.push(id);
        localStorage.setItem('dismissed_notif_ids', JSON.stringify(dismissed));
      }
    } catch {}
  };

  const markAllRead = () => {
    const allIds = new Set(notifications.map(n => n.id));
    setReadIds(allIds);
    localStorage.setItem('read_notif_ids', JSON.stringify([...allIds].filter(i => i !== 'profile-incomplete')));
    // Timed read for profile
    if (allIds.has('profile-incomplete')) {
      try {
        const timed = JSON.parse(localStorage.getItem('read_notif_timed') || '{}');
        timed['profile-incomplete'] = Date.now();
        localStorage.setItem('read_notif_timed', JSON.stringify(timed));
      } catch {}
    }
  };

  // Close bell popup when any other top-level popup announces itself (e.g.
  // hamburger menu). Prevents two overlapping drawers on small screens.
  useEffect(() => {
    const onClosePopups = () => setPopupOpen(false);
    window.addEventListener('cr:close-popups', onClosePopups);
    return () => window.removeEventListener('cr:close-popups', onClosePopups);
  }, []);

  const toggleBell = () => {
    const next = !popupOpen;
    if (next) window.dispatchEvent(new CustomEvent('cr:close-popups'));
    setPopupOpen(next);
  };

  return (
    <div className="relative" data-tour="notif-bell">
      <button
        onClick={toggleBell}
        className="relative w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-[0.95]"
        style={{ background: unreadCount > 0 ? '#FEF2F2' : '#F3F4F6' }}
        aria-label={unreadCount > 0 ? `התראות (${unreadCount} חדשות)` : 'התראות'}
        aria-expanded={popupOpen}
        aria-haspopup="menu"
      >
        <Bell className="w-5 h-5" style={{ color: unreadCount > 0 ? '#DC2626' : '#6B7280' }} aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -left-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white"
            style={{ background: '#DC2626', boxShadow: '0 2px 6px rgba(220,38,38,0.4)' }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown popup */}
      {popupOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPopupOpen(false)} />
          <div className="absolute left-0 top-12 z-50 w-80 rounded-2xl bg-white shadow-2xl border overflow-hidden"
            style={{ borderColor: '#E5E7EB' }} dir="rtl">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#F3F4F6' }}>
              <span className="text-sm font-black" style={{ color: '#1C2E20' }}>התראות</span>
              {unreadCount > 0 && (
                <button onClick={markAllRead} className="text-[11px] font-bold" style={{ color: '#3A7D44' }}>
                  סמן הכל כנקרא
                </button>
              )}
            </div>

            {/* Items */}
            <div className="max-h-72 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="py-8 text-center">
                  <Bell className="w-8 h-8 mx-auto mb-2" style={{ color: '#D1D5DB' }} />
                  <p className="text-sm font-medium" style={{ color: '#9CA3AF' }}>אין התראות</p>
                </div>
              ) : (
                notifications.slice(0, 10).map(n => {
                  const isRead = readIds.has(n.id);
                  return (
                    <div key={n.id}
                      className="flex items-center gap-3 px-4 py-3 transition-all"
                      style={{ background: isRead ? '#fff' : '#FEFCE8', borderBottom: '1px solid #F5F5F5' }}>
                      {/* Click area. navigate */}
                      <button
                        onClick={() => {
                          markRead(n.id);
                          setPopupOpen(false);
                          if (n.type === 'profile' || n.type === 'license') navigate(createPageUrl('UserProfile'));
                          else if (n.type === 'seasonal') {
                            const key = n.id === 'winter-prep' ? `winter_dismissed_${new Date().getFullYear()}` : `sailing_dismissed_${new Date().getFullYear()}`;
                            localStorage.setItem(key, '1');
                            navigate(createPageUrl('Vehicles'));
                          }
                          else if (n.type === 'community') {
                            if (n._communityNotifId) {
                              supabase.from('community_notifications').update({ is_read: true }).eq('id', n._communityNotifId).then(() => {});
                            }
                            navigate(createPageUrl('Community'));
                          }
                          else if (n.vehicleId) {
                            // Map notification type to EditVehicle field for direct navigation
                            const NOTIF_FIELD_MAP = {
                              test: 'test_due_date', insurance: 'insurance_due_date',
                              mileage: 'current_km',
                            };
                            // Safety notifications: derive field from notification id prefix
                            const SAFETY_FIELD_MAP = {
                              pyro: 'pyrotechnics_expiry_date', ext: 'fire_extinguisher_expiry_date', raft: 'life_raft_expiry_date',
                            };
                            let field = NOTIF_FIELD_MAP[n.type];
                            if (n.type === 'safety') {
                              const prefix = (n.id || '').split('-')[0];
                              field = SAFETY_FIELD_MAP[prefix];
                            }
                            if (field) {
                              navigate(`${createPageUrl('EditVehicle')}?id=${n.vehicleId}&field=${field}`);
                            } else {
                              navigate(`${createPageUrl('VehicleDetail')}?id=${n.vehicleId}`);
                            }
                          }
                          else navigate(createPageUrl('Dashboard'));
                        }}
                        className="flex items-center gap-3 flex-1 min-w-0 text-right">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                          style={{
                            background: n.type === 'profile' ? '#EEF2FF'
                              : n.type === 'license' ? (n.isExpired ? '#FEF2F2' : '#FFF8E1')
                              : n.type === 'community' ? '#F5F3FF'
                              : n.type === 'seasonal' ? '#F0F9FF'
                              : n.isExpired ? '#FEF2F2'
                              : n.type === 'safety' ? '#FFF7ED'
                              : n.type === 'maintenance' ? '#FFF8E1'
                              : n.type === 'mileage' ? '#F0FDF4'
                              : '#FFF8E1',
                            boxShadow: !isRead ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
                          }}>
                          {n.type === 'profile'
                            ? <User className="w-4 h-4" style={{ color: '#4338CA' }} />
                            : n.type === 'license'
                              ? <FileText className="w-4 h-4" style={{ color: n.isExpired ? '#DC2626' : '#D97706' }} />
                            : n.type === 'community'
                              ? <MessageSquare className="w-4 h-4" style={{ color: '#7C3AED' }} />
                            : n.type === 'seasonal'
                              ? <span className="text-sm">{n.id === 'winter-prep' ? '❄️' : '⛵'}</span>
                            : n.isExpired
                              ? <AlertTriangle className="w-4 h-4" style={{ color: '#DC2626' }} />
                              : n.type === 'safety'
                                ? <AlertTriangle className="w-4 h-4" style={{ color: '#EA580C' }} />
                                : n.type === 'maintenance'
                                  ? <Wrench className="w-4 h-4" style={{ color: '#D97706' }} />
                                  : n.type === 'mileage'
                                    ? <Gauge className="w-4 h-4" style={{ color: '#16A34A' }} />
                                    : <Bell className="w-4 h-4" style={{ color: '#D97706' }} />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs truncate ${isRead ? 'font-medium' : 'font-bold'}`}
                            style={{ color: n.isExpired ? '#DC2626' : isRead ? '#6B7280' : '#1C2E20' }}>
                            {/* Keep "פג תוקף" in the bell label. here there's no chip
                                to convey the state, so the trailing signal earns its keep. */}
                            {n.label}
                          </p>
                          <p className="text-[10px] truncate" style={{ color: '#9CA3AF' }}>{n.name}</p>
                        </div>
                      </button>
                      {/* Read/unread + dismiss */}
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); isRead ? markUnread(n.id) : markRead(n.id); }}
                          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-gray-100 transition-all"
                          title={isRead ? 'סמן כלא נקרא' : 'סמן כנקרא'}>
                          <div className="w-2.5 h-2.5 rounded-full border-2 transition-all"
                            style={{
                              background: isRead ? 'transparent' : '#DC2626',
                              borderColor: isRead ? '#D1D5DB' : '#DC2626',
                            }} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); dismissNotification(n.id); }}
                          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-50 transition-all"
                          title="הסר התראה">
                          <X className="w-3 h-3" style={{ color: '#D1D5DB' }} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            {notifications.length > 0 && (
              <button onClick={() => { setPopupOpen(false); navigate(createPageUrl('Notifications')); }}
                className="w-full py-2.5 text-center text-xs font-bold border-t transition-all hover:bg-gray-50"
                style={{ color: '#3A7D44', borderColor: '#F3F4F6' }}>
                כל ההתראות →
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Small wrapper around ReviewPopup that owns the scheduling hook.
// Lives as its own component so the hook only runs when the guard above
// actually mounts it — we don't want the schedule evaluated on routes
// where the user isn't authenticated yet.
function ScheduledReviewPrompt({ user }) {
  const { shouldPrompt, markPrompted } = useReviewPromptSchedule(user);
  return (
    <ReviewPopup
      open={shouldPrompt}
      onClose={markPrompted}
      userId={user?.id}
      userEmail={user?.email}
      userName={user?.user_metadata?.full_name || ''}
    />
  );
}

function LayoutInner({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const menuBtnRef = useRef(false);
  const [a11yOpen, setA11yOpen] = useState(false);

  // Close hamburger + a11y when any other top-level popup opens
  useEffect(() => {
    const onClosePopups = () => { setOpen(false); setA11yOpen(false); };
    window.addEventListener('cr:close-popups', onClosePopups);
    return () => window.removeEventListener('cr:close-popups', onClosePopups);
  }, []);
  const [welcomeState, setWelcomeState] = useState(null);
  const [guestPopupClosed, setGuestPopupClosed] = useState(
    () => sessionStorage.getItem('guest_popup_closed') === '1'
  );
  const [mileageReminderOpen, setMileageReminderOpen] = useState(false);
  const [mileageCheckDone, setMileageCheckDone] = useState(false);
  const { isAuthenticated, isGuest, isLoading, user, guestVehicles } = useAuth();
  const [hasVessel, setHasVessel] = useState(false);

  // Side menu stays open across navigation. BottomNav is lifted above the
  // sheet so the user can route between tabs while the drawer is visible.
  // Explicit closers (X button, overlay click, menu item onClick) handle
  // intentional dismissal. we don't want to slam the drawer shut every
  // time the route changes.

  // Track page views for BI dashboard. Normalizes /VehicleDetail?id=... style
  // routes down to just "/VehicleDetail" so we aggregate per feature, not per
  // resource. Fires once per distinct pathname per session to avoid inflating
  // counts when React re-renders the same page.
  useEffect(() => {
    const key = `pv:${location.pathname}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    // Public static pages aren't features. skip to keep the dashboard clean.
    const SKIP = ['/', '/Auth', '/PrivacyPolicy', '/TermsOfService', '/DeleteAccount'];
    if (SKIP.includes(location.pathname)) return;
    // The analytics table aggregates per (event, date). so encode the page
    // into the event name to get one row per (page, day).
    const page = location.pathname.replace(/^\//, '').split('?')[0] || 'root';
    import('@/lib/analytics').then(({ trackEvent }) => {
      trackEvent(`page_view:${page}`);
    });
  }, [location.pathname]);

  // Detect if user has vessels
  const VESSEL_TYPES = ['כלי שייט','מפרשית','סירה מנועית','אופנוע ים','סירת גומי','יאכטה מנועית'];
  const VESSEL_MFRS = ['beneteau','jeanneau','sea-doo','yamaha marine','zodiac','highfield','brig','sea ray','boston whaler'];
  const isVesselVehicle = (v) => {
    if (VESSEL_TYPES.includes(v.vehicle_type)) return true;
    const mfr = (v.manufacturer || '').toLowerCase();
    return VESSEL_MFRS.some(m => mfr.includes(m));
  };

  // Re-check vessels on navigation (catches add/edit vehicle)
  useEffect(() => {
    if (isGuest) {
      setHasVessel((guestVehicles || []).some(isVesselVehicle));
    } else if (isAuthenticated && user) {
      (async () => {
        try {
          const { db } = await import('@/lib/supabaseEntities');
          const members = await db.account_members.filter({ user_id: user.id, status: 'פעיל' });
          if (members.length > 0) {
            const vehicles = await db.vehicles.filter({ account_id: members[0].account_id });
            setHasVessel(vehicles.some(isVesselVehicle));
          }
        } catch {}
      })();
    }
  }, [isGuest, isAuthenticated, user, guestVehicles, location.pathname]);

  // Pages that don't require authentication (legal/compliance pages for app stores)
  const PUBLIC_PAGES = ['/Auth', '/', '/PrivacyPolicy', '/TermsOfService', '/DeleteAccount'];
  const isPublicRoute = PUBLIC_PAGES.includes(location.pathname);
  const isAuthRoute = location.pathname === '/Auth' || location.pathname === '/';

  // Unauthenticated non-guest users → redirect to Auth (except public pages)
  useEffect(() => {
    if (!isLoading && !isAuthenticated && !isGuest && !isPublicRoute) {
      navigate(createPageUrl('Auth'), { replace: true });
    }
  }, [isLoading, isAuthenticated, isGuest, isPublicRoute, navigate]);

  // Authenticated popup. show at most once per calendar day (local time).
  // Stored as YYYY-MM-DD in localStorage so subsequent logins on the same day
  // are silent, and the next login after midnight shows the popup again.
  // Returning-user detection is based on account age, so first-hour accounts
  // get the onboarding variant even on subsequent same-day logins.
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    const storageKey = `welcome_popup_last_shown_${user.id}`;
    const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local tz
    try {
      if (localStorage.getItem(storageKey) === today) return;
    } catch {}
    const createdAt = user.created_at ? new Date(user.created_at).getTime() : 0;
    const ageMs = createdAt ? Date.now() - createdAt : Infinity;
    const isFirstTime = ageMs < 60 * 60 * 1000; // account < 1h old
    setWelcomeState({ isReturning: !isFirstTime, userName: user.full_name || '' });
    try { localStorage.setItem(storageKey, today); } catch {}
  }, [isAuthenticated, user]);

  // Mileage reminder. skip for now (database not migrated yet)
  useEffect(() => {
    if (!isAuthenticated) return;
    setMileageCheckDone(true);
  }, [isAuthenticated]);

  // Guest guard: if guest hasn't confirmed entry via Auth screen, redirect there (skip public pages)
  useEffect(() => {
    if (isGuest && !isAuthRoute && !isPublicRoute && !sessionStorage.getItem('guest_confirmed')) {
      navigate(createPageUrl('Auth'), { replace: true });
    }
  }, [isGuest, isAuthRoute, isPublicRoute, navigate]);

  // Auth page + public legal pages render standalone - no chrome, no auth required
  const STANDALONE_PAGES = ['/Auth', '/', '/PrivacyPolicy', '/TermsOfService', '/DeleteAccount'];
  if (STANDALONE_PAGES.includes(location.pathname) && !isAuthenticated && !isGuest) {
    return <>{children}</>;
  }
  // Auth page for guests too
  if (isAuthRoute && !isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <div>
      <SafeComponent label="GuestWelcomePopup">
        <GuestWelcomePopup open={isGuest && !guestPopupClosed} onClose={() => { setGuestPopupClosed(true); sessionStorage.setItem('guest_popup_closed', '1'); }} />
      </SafeComponent>
      <SafeComponent label="WelcomePopup">
        <WelcomePopup open={welcomeState !== null} isReturningUser={welcomeState?.isReturning ?? false} userName={welcomeState?.userName ?? ''} onClose={() => setWelcomeState(null)} />
      </SafeComponent>
      <SafeComponent label="MileageReminderPopup">
        <MileageReminderPopup
          open={mileageReminderOpen}
          onClose={() => { setMileageReminderOpen(false); setMileageCheckDone(true); }}
        />
      </SafeComponent>
      {isAuthenticated && mileageCheckDone && <SafeComponent label="ReviewManager"><ReviewManager /></SafeComponent>}
      {/* Scheduled review prompt.
       *
       * Gating (see useReviewPromptSchedule.js):
       *   day 10  → first prompt
       *   day 30  → second prompt (only if dismissed without submitting)
       *   every 90 days after → quarterly nudge (until they submit once)
       *
       * Guarded so it can't overlap the welcome popup on fresh logins:
       * we wait until both welcomeState has cleared AND mileageCheckDone.
       * That keeps the sequence one-popup-at-a-time. */}
      {isAuthenticated && !isGuest && welcomeState === null && mileageCheckDone && user && (
        <SafeComponent label="ReviewPrompt">
          <ScheduledReviewPrompt user={user} />
        </SafeComponent>
      )}
      {/* Admin-managed popup engine. Mounted once, gated on the same
       * "welcomeState is clear" sequence so it can't stack on top of the
       * welcome popup. The engine itself enforces a 15-minute global
       * throttle + per-popup frequency, so even with many active popups
       * the user sees at most one at a time. */}
      {(isAuthenticated || isGuest) && welcomeState === null && mileageCheckDone && (
        <SafeComponent label="PopupEngine">
          <PopupEngine />
        </SafeComponent>
      )}
      <AccessibilityPanel open={a11yOpen} onOpenChange={setA11yOpen} />
      <DraggableA11yButton onClick={() => { window.dispatchEvent(new CustomEvent('cr:close-popups')); setA11yOpen(true); }} />
      <div className="min-h-screen bg-white flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 bg-white border-l border-gray-100 flex-col fixed right-0 top-0 bottom-0 z-30">
        <NavContent currentPath={location.pathname} hasVessel={hasVessel} />
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden fixed inset-x-0 top-0" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', zIndex: 9998 }}>
        {isGuest && <GuestBanner />}
        <div className="bg-white border-b border-gray-100 px-3 py-2 flex items-center gap-2.5" dir="rtl">
          {(() => {
            // Ref prevents race condition: overlay close + button toggle fighting
            const btnClicked = menuBtnRef;
            return (
              <>
                <button
                  data-tour="menu"
                  onClick={() => {
                    btnClicked.current = true;
                    const next = !open;
                    if (next) window.dispatchEvent(new CustomEvent('cr:close-popups'));
                    setOpen(next);
                    setTimeout(() => { btnClicked.current = false; }, 150);
                  }}
                  className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all active:scale-90"
                  style={{ background: open ? '#E5E7EB' : '#F3F4F6', position: 'relative', zIndex: 10001 }}
                  aria-label={open ? 'סגור תפריט' : 'פתח תפריט'}
                  aria-expanded={open}
                  aria-haspopup="menu">
                  <Menu className="h-4.5 w-4.5 text-gray-600" aria-hidden="true" />
                </button>
                <Sheet open={open} onOpenChange={(v) => {
                  if (btnClicked.current) return; // ignore overlay close when hamburger was clicked
                  setOpen(v);
                }}>
                  <SheetContent side="right" className="p-0 w-60 !top-0 flex flex-col">
                    <NavContent currentPath={location.pathname} onItemClick={() => setOpen(false)} hasVessel={hasVessel} isMobile />
                  </SheetContent>
                </Sheet>
              </>
            );
          })()}
          <Link to={createPageUrl('Dashboard')} className="flex items-center gap-2">
            <img src={logo} alt="CarReminder" className="h-8 w-8 rounded-lg object-cover shadow-sm" />
            <span className="text-sm font-bold text-gray-900">CarReminder</span>
          </Link>
          <div className="flex-1" />
          {isAuthenticated && <NotificationBell />}
        </div>
      </div>

      {/* Main content */}
      <main className={`flex-1 min-w-0 lg:mr-64 ${isGuest ? 'pt-24 lg:pt-10' : 'pt-14 lg:pt-0'} pb-0`} style={{ overflowX: 'clip' }}>
        <div className="max-w-5xl mx-auto p-4 lg:p-8 min-w-0" style={{ overflowX: 'clip' }}>
          {children}
        </div>
        {/* Spacer so content never hides behind fixed BottomNav on mobile.
            Uses arbitrary [88px] (not h-20=5rem) so it doesn't shrink under
            user font-scaling. the BottomNav has a fixed 12px gesture-pill
            floor + ~60px of content, so we need a real-px floor here too. */}
        <div className="h-[88px] lg:h-0 shrink-0" aria-hidden="true" />
      </main>

      {/* Bottom navigation. mobile only. `sheetOpen` lifts it above the
          side-menu sheet so the user can tap a tab (e.g. מצא מוסך) straight
          from an open menu instead of having to close + re-tap. */}
      <BottomNav sheetOpen={open} />
      </div>
    </div>
  );
}

export default function Layout({ children }) {
  return (
    <AccessibilityProvider>
      <FontScaleProvider>
        <GuestProvider>
          <LayoutInner>{children}</LayoutInner>
        </GuestProvider>
      </FontScaleProvider>
    </AccessibilityProvider>
  );
}
