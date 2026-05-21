import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Home, MapPin, FileText, AlertTriangle, Sparkles, Route as RouteIcon, LayoutDashboard } from 'lucide-react';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';

// Tab order in RTL: rightmost first → leftmost last
// AI Assistant is intentionally LAST so it sits on the visual LEFT
// relatedPaths: pages that should also highlight this tab (e.g. VehicleDetail → Home)
const PERSONAL_TABS = [
  { label: 'ראשי',         icon: Home,           path: 'Dashboard',
    relatedPaths: ['/Vehicles', '/VehicleDetail', '/AddVehicle', '/EditVehicle', '/DemoVehicleDetail'] },
  { label: 'מסמכים',       icon: FileText,       path: 'Documents' },
  { label: 'מצא מוסך',     icon: MapPin,         path: 'FindGarage' },
  { label: 'תאונות',       icon: AlertTriangle,  path: 'Accidents',
    relatedPaths: ['/AddAccident'] },
  { label: 'מומחה AI',     icon: Sparkles,       path: 'AiAssistant', isAi: true },
];

// Driver-in-business tabs: no AI / no community / no peer team here
// (the bell handles notifications, "/Team" is reachable from the side
// menu). The tab bar is pruned to the three things a driver actually
// taps on the go: their assigned vehicles, the day's tasks, and the
// document drawer. No duplicate entries.
const DRIVER_TABS = [
  { label: 'ראשי',    icon: Home,         path: 'MyVehicles',
    relatedPaths: ['/VehicleDetail'] },
  { label: 'משימות',  icon: RouteIcon,    path: 'Routes',
    relatedPaths: ['/RouteDetail', '/CreateRoute'] },
  { label: 'מסמכים',  icon: FileText,     path: 'Documents' },
];

export default function BottomNav({ sheetOpen = false }) {
  const location = useLocation();
  const { isBusiness, isDriver, canManageRoutes, isLoading: roleLoading } = useWorkspaceRole();
  // Hold the bar off-screen while role is still resolving. Without
  // this, drivers saw the personal tab bar (Home / Documents /
  // FindGarage / Accidents / AI) for ~300ms before it flipped to
  // DRIVER_TABS — long enough to register as a glitch on slow
  // devices and to register a stray tap on the wrong tab.
  if (roleLoading) return null;
  // Drivers in a business workspace get a business-flavoured tab bar.
  // Managers / owners in a business workspace keep MOST of the personal
  // tabs (FindGarage, Documents, Accidents are universal). Two changes
  // for them vs. personal users:
  //   • "ראשי" points to BusinessDashboard, not the personal Dashboard.
  //     Personal Dashboard was hidden from the business sidebar; keeping
  //     the bottom-nav tab pointing there would be inconsistent.
  //   • AI tab is removed (private-flow feature; hidden from the menu
  //     via personalOnly).
  // Viewers don't have BusinessDashboard access (managerOnly), so they
  // fall back to the personal Dashboard route as before — the page
  // itself is a safe non-interactive overview.
  let tabs;
  if (isBusiness && isDriver && !canManageRoutes) {
    tabs = DRIVER_TABS;
  } else if (isBusiness && canManageRoutes) {
    tabs = PERSONAL_TABS
      .filter(t => !t.isAi)
      .map(t => t.path === 'Dashboard'
        ? { ...t, label: 'דשבורד', path: 'BusinessDashboard', icon: LayoutDashboard, relatedPaths: undefined }
        : t);
  } else if (isBusiness) {
    // Viewer in business workspace: no BusinessDashboard access.
    tabs = PERSONAL_TABS.filter(t => !t.isAi);
  } else {
    tabs = PERSONAL_TABS;
  }
  const primaryPath = createPageUrl(''); // e.g., '/'

  // Figure out which tab is active. An exact match on the tab's own route wins;
  // otherwise, a related page (e.g. /VehicleDetail under "ראשי") activates it.
  const pathname = location.pathname;
  const activePath = (() => {
    // Exact match first
    for (const t of tabs) {
      if (pathname === createPageUrl(t.path)) return t.path;
    }
    // Related-paths match
    for (const t of tabs) {
      if (t.relatedPaths?.some(rp => pathname === rp || pathname.startsWith(rp + '/'))) return t.path;
    }
    return null;
  })();

  return (
    <div className="fixed bottom-0 left-0 right-0 lg:hidden"
      style={{
        background: '#FFFFFF',
        borderTop: '1px solid #E5E7EB',
        boxShadow: '0 -2px 12px rgba(0,0,0,0.06)',
        // z-index flips based on which modal is likely open:
        //   • Default (z-40): sits BELOW the shadcn Dialog (z-50) so modal
        //     dialogs (DocUpload, ConfirmDelete, ...) cover the nav. That's
        //     what lets their Save buttons stay visible.
        //   • When the hamburger Sheet is open (z-10002): we lift the nav
        //     to z-10010 so the user can tap a tab without first closing
        //     the menu. Layout's own useEffect on location.pathname will
        //     then close the sheet after the tap routes away.
        zIndex: sheetOpen ? 10010 : 40,
        // Bottom inset handling — unified across iOS and Android via the
        // standard CSS env() value.
        //
        // 2026-05-21: the previous Android-userAgent branch hardcoded 0px
        // to "stay flush against the system nav bar". That assumed
        // `windowOptOutEdgeToEdgeEnforcement=true` (styles.xml) was inset-
        // ing the WebView above the nav bar on every Android — but that
        // attribute is Android 15+ (API 35) only, silently ignored on
        // Android 14 and below. Capacitor 8 sets
        // `decorFitsSystemWindows=false` by default on every Activity, so
        // on Android ≤14 (still most installed devices) the WebView IS
        // edge-to-edge and our BottomNav was sitting underneath the
        // system nav buttons / gesture pill. Multiple users reported
        // labels cropped behind back/home/recent (see project_android_
        // bottomnav_inset_bug.md).
        //
        // Behaviour after the unification:
        //   • Android 15+ with opt-out working: env() = 0 → max(0, 4px)
        //     = 4px breathing room. Worst case = the same "tiny band"
        //     the original commit tried to eliminate, but 4px not 24px.
        //   • Android ≤14 (Capacitor default edge-to-edge) or 15+ where
        //     opt-out didn't fire: env() = real nav-bar/gesture height
        //     → padding clears the system UI correctly.
        //   • iOS gesture pill (iPhone X+): env() = ~34px → padding
        //     clears the home indicator (unchanged from before).
        //   • iOS classic (no notch): env() = 0 → max(0, 4px) = 4px floor
        //     (unchanged).
        paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 4px)',
        // Horizontal safe-area: WKWebView's 100vw includes the device's
        // curved corner region, so `fixed inset-x-0` extends edge-to-
        // edge but the inner tabs distributed via `justify-around` got
        // clipped by the rounded corners (visible on iPhone 14+ Pro
        // Dynamic Island devices in TestFlight 153 — last tab "מומחה"
        // appeared cut off). Padding the inset values here keeps the
        // background full-width but pulls the content into the visible
        // rectangle. In portrait these values are 0 on most devices,
        // so the layout is unchanged; in landscape they correctly clear
        // the notch.
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
      }}
      role="navigation" aria-label="ניווט ראשי">
      <div className="flex justify-around items-center max-w-md mx-auto px-1 py-1">
        {tabs.map(tab => {
          const active = activePath === tab.path;
          // AI button: special amber accent when active
          const activeBg = tab.isAi ? '#D97706' : '#2D5233';
          const activeIconColor = tab.isAi ? '#FFFBEB' : '#FFBF00';
          const activeTextColor = tab.isAi ? '#92400E' : '#2D5233';
          return (
            <Link key={tab.path} to={createPageUrl(tab.path)}
              data-tour={tab.isAi ? 'ai-tab' : undefined}
              className="flex flex-col items-center gap-0.5 py-1 px-2 min-w-0">
              {/* w-11 h-11 = 44pt — matches Apple HIG and Material
                  Design minimum tap-target size. Was w-9 h-9 (36pt)
                  which user reported as "too small, hard to tap".
                  The bar height grows with the icon container; the
                  surrounding `max-w-md mx-auto` keeps overall width
                  unchanged on phones. */}
              <div className="w-11 h-11 rounded-xl flex items-center justify-center transition-all relative"
                style={{
                  background: active ? activeBg : (tab.isAi ? '#FFFBEB' : 'transparent'),
                  border: tab.isAi && !active ? '1.5px solid #FEF3C7' : 'none',
                }}>
                <tab.icon className="w-5 h-5" strokeWidth={active ? 2.5 : 1.8}
                  style={{ color: active ? activeIconColor : (tab.isAi ? '#D97706' : '#9CA3AF') }} />
                {/* The always-on green dot used to imply "online" status for
                    the AI service, which misled users when the service was
                    actually down. The amber border + color already make the
                    tab visually distinct; the dot is removed. */}
              </div>
              {/* Tab label uses line-clamp-1 instead of whitespace-nowrap so
                  when the user bumps OS font size the label shrinks to a
                  single truncated line rather than overflowing into the
                  neighbouring tab or disappearing behind the icon. */}
              <span className="text-[10px] font-bold line-clamp-1 truncate text-center max-w-full"
                style={{ color: active ? activeTextColor : (tab.isAi ? '#D97706' : '#9CA3AF') }}>
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
