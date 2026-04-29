import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Home, MapPin, FileText, AlertTriangle, Sparkles, Route as RouteIcon } from 'lucide-react';
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
  // Managers / owners / viewers in a business workspace keep the
  // personal tabs since they ALSO use the personal-flow pages
  // (FindGarage, etc.) regularly.
  const tabs = (isBusiness && isDriver && !canManageRoutes) ? DRIVER_TABS : PERSONAL_TABS;
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
        // System-nav inset handling, split by platform because the same
        // `env(safe-area-inset-bottom)` value means very different things:
        //
        //   • Android (Capacitor WebView, windowOptOutEdgeToEdgeEnforcement=
        //     true): the OS already reserves space for the nav bar BELOW
        //     our WebView and paints it with android:navigationBarColor
        //     (white, matches this bar). Any padding we add here becomes a
        //     visible band between our labels and the system buttons. the
        //     user's "הרווח הזה" complaint. Drop to 0 so the bar is flush.
        //   • iOS / gesture-pill devices: env(safe-area-inset-bottom) is a
        //     real ~34 px reserved area we DO need to clear. Keep it.
        paddingBottom: /Android/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '')
          ? '0px'
          : 'min(max(env(safe-area-inset-bottom, 0px), 4px), 10px)',
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
              <div className="w-9 h-9 rounded-xl flex items-center justify-center transition-all relative"
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
              <span className="text-[10px] font-bold line-clamp-1 text-center max-w-full"
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
