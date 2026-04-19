import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Home, MapPin, FileText, AlertTriangle, Sparkles } from 'lucide-react';

// Tab order in RTL: rightmost first → leftmost last
// AI Assistant is intentionally LAST so it sits on the visual LEFT
// relatedPaths: pages that should also highlight this tab (e.g. VehicleDetail → Home)
const tabs = [
  { label: 'ראשי',         icon: Home,           path: 'Dashboard',
    relatedPaths: ['/Vehicles', '/VehicleDetail', '/AddVehicle', '/EditVehicle', '/DemoVehicleDetail'] },
  { label: 'מסמכים',       icon: FileText,       path: 'Documents' },
  { label: 'מצא מוסך',     icon: MapPin,         path: 'FindGarage' },
  { label: 'תאונות',       icon: AlertTriangle,  path: 'Accidents',
    relatedPaths: ['/AddAccident'] },
  { label: 'מומחה AI',     icon: Sparkles,       path: 'AiAssistant', isAi: true },
];

export default function BottomNav() {
  const location = useLocation();
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
        zIndex: 9999,
        // Force at least 12px clearance — Android gesture nav often reports
        // safe-area-inset-bottom as 0 even though the gesture pill IS there,
        // which makes the nav clip behind it. max() guarantees a floor.
        paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)',
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
                {tab.isAi && !active && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-500 ring-2 ring-white" />
                )}
              </div>
              <span className="text-[10px] font-bold whitespace-nowrap"
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
