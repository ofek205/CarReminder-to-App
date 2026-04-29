import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { createPageUrl } from "@/utils";
import { supabase } from '@/lib/supabase';
import { Car, Ship, LayoutDashboard, Settings, Users, User, FileText, Menu, LogOut, Wrench, Star, UserCircle, AlertTriangle, Mail, UserPlus, ShieldCheck, MapPin, MessageSquare, Sparkles, ChevronLeft, Receipt, TrendingUp, Briefcase, Truck } from 'lucide-react';
import logo from '@/assets/logo.png';
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FontScaleProvider } from "@/components/shared/FontScaleProvider";
import WelcomePopup from "@/components/shared/WelcomePopup";
import GuestWelcomePopup from "@/components/shared/GuestWelcomePopup";
import MileageReminderPopup from "@/components/shared/MileageReminderPopup";
import ReviewManager from "@/components/shared/ReviewManager";
import ReviewPopup from "@/components/shared/ReviewPopup";
import useReviewPromptSchedule from "@/hooks/useReviewPromptSchedule";
import PopupEngine from "@/components/shared/PopupEngine";
import { SafeComponent } from "@/components/shared/SafeComponent";
import { GuestProvider, useAuth } from "@/components/shared/GuestContext";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import WorkspaceSwitcher from "@/components/workspace/WorkspaceSwitcher";
import useWorkspaceRole from "@/hooks/useWorkspaceRole";
import { AccessibilityProvider } from "@/components/shared/AccessibilityContext";
import AccessibilityPanel from "@/components/shared/AccessibilityPanel";
import BottomNav from "@/components/shared/BottomNav";
import StagingBanner from "@/components/shared/StagingBanner";
import useIsAdmin from "@/hooks/useIsAdmin";
import useSharedVehicleRealtime from "@/hooks/useSharedVehicleRealtime";
// Lazy-load the 568-line bell + its useEffect-heavy data fetching. It
// renders only for authenticated users, so deferring it keeps the
// initial bundle smaller and avoids parsing notification logic for
// guests who'll never see it.
const NotificationBell = React.lazy(() => import("@/components/shared/NotificationBell"));

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
  { name: 'Community',             label: 'קהילה וייעוץ',    icon: Users,           guestAllowed: true, driverHidesIfFlag: 'driver_hide_community' },
  { name: 'AiAssistant',           label: 'התייעצות עם מומחה AI', icon: Sparkles,    guestAllowed: true, driverHidesIfFlag: 'driver_hide_ai' },
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
  { name: 'BusinessSettings',      label: 'הגדרות החשבון העסקי', icon: Briefcase,    guestAllowed: false, businessOnly: true, ownerOnly: true },
  { name: 'AdminReviews',          label: 'חוות דעת',         icon: Star,            guestAllowed: true },
  { name: 'Contact',               label: 'צור קשר',          icon: MessageSquare,   guestAllowed: true },
  //  Phase 6 — B2B Routes & Tasks. businessOnly hides for personal
  //  workspaces (private users see nothing). managerOnly / driverAllowed
  //  further gate by workspace role. routes-list page itself handles
  //  the manager-vs-driver mode switch internally.
  { divider: true, title: 'תפעול', businessOnly: true },
  { name: 'BusinessDashboard',     label: 'דשבורד עסקי',        icon: LayoutDashboard, guestAllowed: false, businessOnly: true, managerOnly: true },
  { name: 'MyVehicles',            label: 'הרכבים שלי',         icon: Truck,           guestAllowed: false, businessOnly: true, driverOnly: true },
  { name: 'Fleet',                 label: 'צי הרכבים',          icon: Truck,           guestAllowed: false, businessOnly: true, managerOnly: true },
  { name: 'Routes',                label: 'מסלולים ומשימות',   icon: MapPin,          guestAllowed: false, businessOnly: true },
  { name: 'Drivers',               label: 'נהגים',              icon: Users,           guestAllowed: false, businessOnly: true, managerOnly: true },
  { divider: true, title: 'אנליטיקה', businessOnly: true },
  { name: 'ActivityLog',           label: 'יומן פעילות',       icon: FileText,        guestAllowed: false, businessOnly: true },
  { name: 'Reports',               label: 'דוחות וניתוחים',     icon: TrendingUp,      guestAllowed: false, businessOnly: true, managerOnly: true },
  { name: 'Expenses',              label: 'הוצאות תפעול',      icon: Receipt,         guestAllowed: false, businessOnly: true, managerOnly: true },
  { divider: true, title: 'ניהול אדמין', adminOnly: true },
  { name: 'AdminDashboard',        label: 'לוח ניהול',        icon: ShieldCheck,     guestAllowed: false, adminOnly: true },
  { name: 'EmailCenter',           label: 'ניהול מיילים',      icon: Mail,            guestAllowed: false, adminOnly: true },
  { name: 'AdminAiSettings',       label: 'הגדרות AI',         icon: Sparkles,        guestAllowed: false, adminOnly: true },
  { name: 'AdminBusinessRequests', label: 'בקשות חשבון עסקי',  icon: Briefcase,       guestAllowed: false, adminOnly: true },
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
  // Source of truth for admin status is the server-side is_admin() RPC
  // (via useIsAdmin hook) — matches every admin page's own check. The
  // old inline `role==='admin' || email==='ofek205@gmail.com'` fallback
  // could drift from the RPC's allow-list, making the sidebar link visible
  // for users the page would block, or vice-versa.
  const adminCheck = useIsAdmin();
  const isAdmin = adminCheck === true;
  // Phase 6 — workspace-aware nav gating. isBusiness becomes true only
  // when the active workspace is a business workspace; private users
  // never see businessOnly items.
  // Phase 9 step 8 — owners-only items + driver-hide flags driven by
  // accounts.business_meta toggles set in /BusinessSettings.
  const { isBusiness, isDriver, isOwner, canManageRoutes, canDriveRoutes, businessMeta } = useWorkspaceRole();
  const businessAccess = canManageRoutes || canDriveRoutes;
  // On mobile, hide items that are already in the bottom nav
  const visibleItems = navItems.filter(item =>
    (item.divider ? (
      (!item.adminOnly    || isAdmin) &&
      (!item.businessOnly || (isBusiness && businessAccess))
    ) : (
      (isAuthenticated || item.guestAllowed) &&
      (!item.adminOnly     || isAdmin) &&
      (!item.businessOnly  || (isBusiness && businessAccess)) &&
      (!item.managerOnly   || canManageRoutes) &&
      (!item.driverOnly    || canDriveRoutes) &&
      (!item.ownerOnly     || isOwner) &&
      (!item.vesselOnly    || hasVessel) &&
      // Driver in business workspace — hide items the manager flagged.
      !(isBusiness && isDriver && item.driverHidesIfFlag && businessMeta?.[item.driverHidesIfFlag]) &&
      (!isMobile || !BOTTOM_NAV_PATHS.has(item.name))
    ))
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

      {/* Navigation - scrollable.
          `min-h-0` is the key bit: flex children default to min-height: auto,
          which means a `flex-1` element refuses to shrink below the height
          of its own content. With ~13 nav items + dividers, on shorter
          windows the nav grew taller than its container and the bottom
          items (admin section, footer) clipped offscreen with no scroll.
          min-h-0 unblocks flex-shrink so overflow-y-auto can kick in. */}
      <nav className={`flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5 ${isMobile ? 'pb-4' : ''}`} dir="rtl">
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

  // Real-time sync between participants of a shared vehicle. The hook
  // self-gates on `isGuest`/`!user` so it's a no-op for guests; when
  // mounted by an authenticated user it subscribes to their app
  // notifications + their vehicle_shares rows and invalidates the
  // affected query caches the moment a peer makes a change. Without
  // this, the recipient would only see edits after manual refresh.
  useSharedVehicleRealtime();

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
    // Close the side drawer (and any other open popovers) so the welcome
    // modal isn't covered by the menu sheet. New users on a phone often
    // tap the hamburger before they realise the welcome popup is meant
    // to be the focal point — the cr:close-popups listener inside the
    // drawer state hook handles the dismiss.
    try { window.dispatchEvent(new CustomEvent('cr:close-popups')); } catch {}
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
      <StagingBanner />
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

      {/* Desktop notification bell — fixed top-left, parallel to the
          right-side sidebar. The same NotificationBell component renders
          its own dropdown panel; we just need to anchor it on the
          opposite corner from the sidebar so the bell + bell-popover
          don't overlap. Hidden on mobile because the mobile top bar
          below has its own bell already. */}
      {isAuthenticated && (
        <div className="hidden lg:block fixed top-4 left-4 z-40">
          <React.Suspense fallback={<div className="w-10 h-10" />}>
            <NotificationBell />
          </React.Suspense>
        </div>
      )}

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
          {isAuthenticated && <WorkspaceSwitcher />}
          {isAuthenticated && (
            <React.Suspense fallback={<div className="w-10 h-10" />}>
              <NotificationBell />
            </React.Suspense>
          )}
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
          <WorkspaceProvider>
            <LayoutInner>{children}</LayoutInner>
          </WorkspaceProvider>
        </GuestProvider>
      </FontScaleProvider>
    </AccessibilityProvider>
  );
}
