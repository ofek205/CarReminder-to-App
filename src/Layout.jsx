import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { createPageUrl } from "@/utils";
import { supabase } from '@/lib/supabase';
import { Car, Ship, LayoutDashboard, Bell, Settings, Users, FileText, Menu, X, LogOut, Wrench, Star, UserCircle, CheckCircle, AlertTriangle, XCircle, Phone, Mail, CreditCard, UserPlus, ShieldCheck, MapPin } from 'lucide-react';
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
import { SafeComponent } from "@/components/shared/SafeComponent";
import { GuestProvider, useAuth } from "@/components/shared/GuestContext";
import { format, parseISO } from 'date-fns';
import { AccessibilityProvider } from "@/components/shared/AccessibilityContext";
import AccessibilityPanel from "@/components/shared/AccessibilityPanel";
import BottomNav from "@/components/shared/BottomNav";

const navItems = [
  // ── ראשי ──
  { name: 'Dashboard',             label: 'דף הבית שלי',     icon: LayoutDashboard, guestAllowed: true },
  { name: 'Vehicles',              label: 'רכבים',            icon: Car,             guestAllowed: true },
  { name: 'Vehicles?category=vessel', label: 'כלי שייט',      icon: Ship,            guestAllowed: true, vesselOnly: true },
  // ── ניהול ──
  { divider: true, title: 'ניהול' },
  { name: 'MaintenanceTemplates',  label: 'טיפולים ותיקונים', icon: Settings,        guestAllowed: true },
  { name: 'Documents',             label: 'מסמכים',           icon: FileText,        guestAllowed: true },
  { name: 'Accidents',             label: 'תאונות',           icon: AlertTriangle,   guestAllowed: true },
  // ── כלים ──
  { divider: true, title: 'כלים' },
  { name: 'FindGarage',            label: 'מצא מוסך',        icon: MapPin,          guestAllowed: true },
  { name: 'Notifications',         label: 'התראות',           icon: Bell,            guestAllowed: true },
  { name: 'ReminderSettingsPage',  label: 'הגדרות תזכורות',  icon: Settings,        guestAllowed: true },
  // ── חשבון ──
  { divider: true, title: 'חשבון' },
  { name: 'UserProfile',           label: 'אזור אישי',       icon: UserCircle,      guestAllowed: true },
  { name: 'AccountSettings',       label: 'שיתוף חשבון',      icon: Users,           guestAllowed: true },
  { name: 'AdminReviews',          label: 'חוות דעת',         icon: Star,            guestAllowed: true },
  { name: 'AdminDashboard',        label: 'לוח ניהול',        icon: ShieldCheck,     guestAllowed: false, adminOnly: true },
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
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center justify-between gap-2" dir="rtl">
      <p className="text-sm font-semibold text-amber-800 leading-tight">מצב אורח - הנתונים נשמרים זמנית במכשיר בלבד</p>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          to={createPageUrl('Auth')}
          className="text-sm font-bold text-amber-700 underline underline-offset-2 hover:text-amber-900 transition-colors py-2 px-2 touch-manipulation"
        >
          יש לי חשבון
        </Link>
        <Button onClick={() => navigate(createPageUrl('Auth'))} className="bg-[#2D5233] hover:bg-[#1E3D24] text-white text-sm font-bold h-11 px-4 gap-1.5 touch-manipulation">
          <UserPlus className="h-4 w-4" />
          הירשם בחינם
        </Button>
      </div>
    </div>
  );
}

function UserPopover() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          title="פתח אזור אישי"
          className="flex items-center gap-3 cursor-pointer group rounded-xl px-1 py-1 transition-all duration-200 hover:bg-[#E8F2EA]"
        >
          <img src={logo} alt="CarReminder" className="w-10 h-10 rounded-xl object-cover shadow-sm transition-transform duration-200 group-hover:scale-105" />
          <div>
            <h1 className="text-gray-900 mx-4 text-lg font-bold leading-tight group-hover:text-[#2D5233] transition-colors duration-200">ניהול רכבים</h1>
            <p className="text-slate-500 mx-4 my-1 text-xs">פתח אזור אישי</p>
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

function NavContent({ currentPath, onItemClick, hasVessel }) {
  const { isAuthenticated, isGuest, user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin' || user?.email === 'ofek205@gmail.com';
  const visibleItems = navItems.filter(item =>
    item.divider || (
      (isAuthenticated || item.guestAllowed) &&
      (!item.adminOnly || isAdmin) &&
      (!item.vesselOnly || hasVessel)
    )
  );

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-5 border-b border-gray-100">
        {isAuthenticated ? <UserPopover /> : (
          <div className="flex items-center gap-3 px-1 py-1">
            <img src={logo} alt="CarReminder" className="w-10 h-10 rounded-xl object-cover shadow-sm" />
            <div>
              <h1 className="text-gray-900 mx-4 text-lg font-bold leading-tight">ניהול רכבים</h1>
              <p className="text-slate-500 mx-4 my-1 text-xs">מצב אורח</p>
            </div>
          </div>
        )}
      </div>
      <nav className="flex-1 p-3 space-y-0.5" dir="rtl">
        {visibleItems.map((item, i) => {
          if (item.divider) {
            return (
              <div key={`div-${i}`} className="pt-3 pb-1.5 px-4">
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#9CA3AF' }}>{item.title}</p>
              </div>
            );
          }
          const itemUrl = item.name.includes('?') ? `/${item.name}` : createPageUrl(item.name);
          const currentSearch = window.location.search || '';
          let isActive;
          if (item.vesselOnly) {
            // "כלי שייט" is active only when on /Vehicles?category=vessel
            isActive = currentPath.includes('/Vehicles') && currentSearch.includes('category=vessel');
          } else if (item.name === 'Vehicles') {
            // "רכבים" is active on /Vehicles WITHOUT ?category=vessel
            isActive = currentPath.includes('/Vehicles') && !currentSearch.includes('category=vessel');
          } else {
            isActive = currentPath.includes(createPageUrl(item.name));
          }
          return (
            <Link
              key={item.name}
              to={itemUrl}
              onClick={onItemClick}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200
                ${isActive ?
              'bg-[#E8F2EA] text-[#2D5233] border border-[#D8E5D9]' :
              'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`
              }>
              <item.icon className={`h-5 w-5 ${isActive ? 'text-[#2D5233]' : 'text-gray-400'}`} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-gray-100 space-y-1" dir="rtl">
        <div className="px-4 py-2">
          <FontScaleControls />
        </div>
        {isAuthenticated ? (
          <button
            onClick={handleLogout} className="bg-slate-300 text-slate-950 px-4 py-2.5 text-sm font-medium rounded-xl flex items-center gap-3 hover:bg-gray-50 hover:text-gray-900 w-full transition-all">
            <LogOut className="text-slate-950 lucide lucide-log-out h-5 w-5" />
            התנתקות
          </button>
        ) : (
          <button
            onClick={() => navigate(createPageUrl('Auth'))}
            className="bg-[#2D5233] text-white px-4 py-2.5 text-sm font-medium rounded-xl flex items-center gap-3 hover:bg-[#1E3D24] w-full transition-all">
            <UserPlus className="h-5 w-5" />
            הירשם / התחבר
          </button>
        )}
      </div>
    </div>
  );
}

function DraggableA11yButton({ onClick }) {
  const [pos, setPos] = useState({ x: 24, y: window.innerHeight - 140 });
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });
  const moved = useRef(false);

  const onMouseDown = (e) => {
    dragging.current = true;
    moved.current = false;
    offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  };

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!dragging.current) return;
      moved.current = true;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 40, e.clientX - offset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 120, e.clientY - offset.current.y)),
      });
    };
    const onMouseUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  return (
    <button
      onMouseDown={onMouseDown}
      onClick={(e) => { if (!moved.current) onClick(); }}
      aria-label="פתח הגדרות נגישות"
      style={{ left: pos.x, top: pos.y, position: 'fixed', cursor: dragging.current ? 'grabbing' : 'grab' }}
      className="z-50 text-3xl leading-none select-none focus-visible:outline-none"
    >
      ♿
    </button>
  );
}

// ── Notification Bell with dropdown (authenticated users only) ───────────────
function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [readIds, setReadIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('read_notif_ids') || '[]')); } catch { return new Set(); }
  });
  const [popupOpen, setPopupOpen] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { db } = await import('@/lib/supabaseEntities');
        const members = await db.account_members.filter({ user_id: user.id, status: 'פעיל' });
        if (members.length === 0) return;
        const vehicles = await db.vehicles.filter({ account_id: members[0].account_id });
        const items = [];
        const now = new Date();
        vehicles.forEach(v => {
          const name = v.nickname || v.manufacturer || 'רכב';
          if (v.test_due_date) {
            const days = Math.ceil((new Date(v.test_due_date) - now) / 86400000);
            if (days <= 60) items.push({ id: `test-${v.id}`, vehicleId: v.id, type: 'test', label: days < 0 ? 'טסט פג תוקף' : `טסט בעוד ${days} ימים`, name, days, isExpired: days < 0 });
          }
          if (v.insurance_due_date) {
            const days = Math.ceil((new Date(v.insurance_due_date) - now) / 86400000);
            if (days <= 60) items.push({ id: `ins-${v.id}`, vehicleId: v.id, type: 'insurance', label: days < 0 ? 'ביטוח פג תוקף' : `ביטוח בעוד ${days} ימים`, name, days, isExpired: days < 0 });
          }
        });
        items.sort((a, b) => a.days - b.days);
        setNotifications(items);
      } catch {}
    })();
  }, [user]);

  const unreadCount = notifications.filter(n => !readIds.has(n.id)).length;

  const markRead = (id) => {
    setReadIds(prev => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem('read_notif_ids', JSON.stringify([...next]));
      return next;
    });
  };

  const markAllRead = () => {
    const allIds = new Set(notifications.map(n => n.id));
    setReadIds(allIds);
    localStorage.setItem('read_notif_ids', JSON.stringify([...allIds]));
  };

  return (
    <div className="relative">
      <button
        onClick={() => setPopupOpen(o => !o)}
        className="relative w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-[0.95]"
        style={{ background: unreadCount > 0 ? '#FEF2F2' : '#F3F4F6' }}
        aria-label="התראות"
      >
        <Bell className="w-5 h-5" style={{ color: unreadCount > 0 ? '#DC2626' : '#6B7280' }} />
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
            <div className="max-h-64 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="py-8 text-center">
                  <Bell className="w-8 h-8 mx-auto mb-2" style={{ color: '#D1D5DB' }} />
                  <p className="text-sm font-medium" style={{ color: '#9CA3AF' }}>אין התראות</p>
                </div>
              ) : (
                notifications.slice(0, 8).map(n => {
                  const isRead = readIds.has(n.id);
                  return (
                    <button key={n.id}
                      onClick={() => { markRead(n.id); setPopupOpen(false); navigate(`${createPageUrl('VehicleDetail')}?id=${n.vehicleId}`); }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-right transition-all hover:bg-gray-50"
                      style={{ background: isRead ? '#fff' : '#FEFCE8', borderBottom: '1px solid #F9FAFB' }}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: n.isExpired ? '#FEF2F2' : '#FFF8E1' }}>
                        {n.isExpired ? <AlertTriangle className="w-4 h-4" style={{ color: '#DC2626' }} /> : <Bell className="w-4 h-4" style={{ color: '#D97706' }} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold truncate" style={{ color: n.isExpired ? '#DC2626' : '#1C2E20' }}>{n.label}</p>
                        <p className="text-[10px] truncate" style={{ color: '#9CA3AF' }}>{n.name}</p>
                      </div>
                      {!isRead && <div className="w-2 h-2 rounded-full shrink-0" style={{ background: '#DC2626' }} />}
                    </button>
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

function LayoutInner({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [a11yOpen, setA11yOpen] = useState(false);
  const [welcomeState, setWelcomeState] = useState(null);
  const [guestPopupClosed, setGuestPopupClosed] = useState(
    () => sessionStorage.getItem('guest_popup_closed') === '1'
  );
  const [mileageReminderOpen, setMileageReminderOpen] = useState(false);
  const [mileageCheckDone, setMileageCheckDone] = useState(false);
  const { isAuthenticated, isGuest, isLoading, user, guestVehicles } = useAuth();
  const [hasVessel, setHasVessel] = useState(false);

  // Detect if user has vessels
  const VESSEL_TYPES = ['כלי שייט','מפרשית','סירה מנועית','אופנוע ים','סירת גומי','יאכטה מנועית'];
  const VESSEL_MFRS = ['beneteau','jeanneau','sea-doo','yamaha marine','zodiac','highfield','brig','sea ray','boston whaler'];
  const isVesselVehicle = (v) => {
    if (VESSEL_TYPES.includes(v.vehicle_type)) return true;
    const mfr = (v.manufacturer || '').toLowerCase();
    return VESSEL_MFRS.some(m => mfr.includes(m));
  };

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
  }, [isGuest, isAuthenticated, user, guestVehicles]);

  const isAuthRoute = location.pathname === '/Auth' || location.pathname === '/';

  // Unauthenticated non-guest users → redirect to Auth
  useEffect(() => {
    if (!isLoading && !isAuthenticated && !isGuest && !isAuthRoute) {
      navigate(createPageUrl('Auth'), { replace: true });
    }
  }, [isLoading, isAuthenticated, isGuest, isAuthRoute, navigate]);

  // Authenticated popup — show once per browser session.
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    if (sessionStorage.getItem(`welcome_popup_shown_${user.id}`)) return;
    const storageKey = `welcome_seen_${user.id}`;
    const isFirstTime = !localStorage.getItem(storageKey);
    setWelcomeState({ isReturning: !isFirstTime, userName: user.full_name || '' });
    localStorage.setItem(storageKey, '1');
    sessionStorage.setItem(`welcome_popup_shown_${user.id}`, '1');
  }, [isAuthenticated, user]);

  // Mileage reminder — skip for now (database not migrated yet)
  useEffect(() => {
    if (!isAuthenticated) return;
    setMileageCheckDone(true);
  }, [isAuthenticated]);

  // Guest guard: if guest hasn't confirmed entry via Auth screen, redirect there
  useEffect(() => {
    if (isGuest && !isAuthRoute && !sessionStorage.getItem('guest_confirmed')) {
      navigate(createPageUrl('Auth'), { replace: true });
    }
  }, [isGuest, isAuthRoute, navigate]);

  // Auth page renders standalone - no chrome
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
      <AccessibilityPanel open={a11yOpen} onOpenChange={setA11yOpen} />
      <DraggableA11yButton onClick={() => setA11yOpen(true)} />
      <div className="min-h-screen bg-white flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 bg-white border-l border-gray-100 flex-col fixed right-0 top-0 bottom-0 z-30">
        <NavContent currentPath={location.pathname} hasVessel={hasVessel} />
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden fixed inset-x-0 top-0 z-50" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', background: '#fff' }}>
        {isGuest && <GuestBanner />}
        <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-2">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="bg-slate-300 text-slate-950 shrink-0 text-sm font-medium opacity-100 rounded-2xl inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover:bg-accent hover:text-accent-foreground h-11 w-11">
                <Menu className="h-6 w-6" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="p-0 w-72">
              <NavContent currentPath={location.pathname} onItemClick={() => setOpen(false)} hasVessel={hasVessel} />
            </SheetContent>
          </Sheet>
          {isAuthenticated ? (
            <>
              <UserPopover />
              <div className="flex-1" />
              <NotificationBell />
            </>
          ) : (
            <Link to={createPageUrl('Dashboard')} className="flex items-center gap-2">
              <img src={logo} alt="CarReminder" className="h-11 rounded-xl object-contain shadow-sm" />
            </Link>
          )}
        </div>
      </div>

      {/* Main content */}
      <main className={`flex-1 lg:mr-64 ${isGuest ? 'pt-32 lg:pt-10' : 'pt-24 lg:pt-0'} pb-0`}>
        <div className="max-w-5xl mx-auto p-4 lg:p-8">
          {children}
        </div>
        {/* Spacer so content never hides behind fixed BottomNav on mobile */}
        <div className="h-24 lg:h-0 shrink-0" aria-hidden="true" />
      </main>

      {/* Bottom navigation — mobile only */}
      <BottomNav />
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
