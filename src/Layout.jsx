import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { createPageUrl } from "@/utils";
import { supabase } from '@/lib/supabase';
import { Car, LayoutDashboard, Bell, Settings, Users, FileText, Menu, X, LogOut, Wrench, Star, UserCircle, CheckCircle, AlertTriangle, XCircle, Phone, Mail, CreditCard, UserPlus, ShieldCheck, MapPin } from 'lucide-react';
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
  { name: 'MaintenanceTemplates',  label: 'טיפולים ותיקונים', icon: Settings,        guestAllowed: true },
  // ── מסמכים ותאונות ──
  { name: 'Documents',             label: 'מסמכים',           icon: FileText,        guestAllowed: true },
  { name: 'Accidents',             label: 'תאונות',           icon: AlertTriangle,   guestAllowed: true },
  // ── כלים ──
  { name: 'FindGarage',            label: 'מצא מוסך',        icon: MapPin,          guestAllowed: true },
  { name: 'Notifications',         label: 'התראות',           icon: Bell,            guestAllowed: true },
  { name: 'ReminderSettingsPage',  label: 'הגדרות תזכורות',  icon: Bell,            guestAllowed: true },
  // ── חשבון ──
  { name: 'UserProfile',           label: 'אזור אישי',       icon: UserCircle,      guestAllowed: true },
  { name: 'AccountSettings',       label: 'שיתוף משפחתי',     icon: Users,           guestAllowed: true },
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

function NavContent({ currentPath, onItemClick }) {
  const { isAuthenticated, isGuest, user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin' || user?.email === 'ofek205@gmail.com';
  const visibleItems = navItems.filter(item =>
    (isAuthenticated || item.guestAllowed) && (!item.adminOnly || isAdmin)
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
      <nav className="flex-1 p-3 space-y-1" dir="rtl">
        {visibleItems.map((item) => {
          const isActive = currentPath.includes(createPageUrl(item.name));
          return (
            <Link
              key={item.name}
              to={createPageUrl(item.name)}
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
  const [pos, setPos] = useState({ x: 24, y: window.innerHeight - 72 });
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
        y: Math.max(0, Math.min(window.innerHeight - 40, e.clientY - offset.current.y)),
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
  const { isAuthenticated, isGuest, isLoading, user } = useAuth();

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
        <NavContent currentPath={location.pathname} />
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden fixed inset-x-0 top-0 z-50">
        {isGuest && <GuestBanner />}
        <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-2">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="bg-slate-300 text-slate-950 shrink-0 text-sm font-medium opacity-100 rounded-2xl inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover:bg-accent hover:text-accent-foreground h-11 w-11">
                <Menu className="h-6 w-6" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="p-0 w-72">
              <NavContent currentPath={location.pathname} onItemClick={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          {isAuthenticated ? <UserPopover /> : (
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
