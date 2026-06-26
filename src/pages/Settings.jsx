/**
 * Settings. unified hub for personal/account/notifications.
 *
 * Replaces three separate sidebar entries (אזור אישי / שיתוף חשבון /
 * הגדרות תזכורות) with one entry point + tab navigation. Each tab
 * renders the existing page in `embedded` mode so we don't duplicate
 * their internal headers.
 *
 * URL support:
 *   /Settings              → Profile tab (default)
 *   /Settings?tab=profile  → Profile
 *   /Settings?tab=account  → Account + sharing
 *   /Settings?tab=alerts   → Notifications + reminders
 *
 * The old standalone routes (/UserProfile, /AccountSettings,
 * /ReminderSettingsPage) still work for back-compat. The side menu
 * points at /Settings now, but push-notification deep links etc. can
 * continue to use the old URLs.
 */
import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { User, Users, Bell, Shield, ChevronLeft } from 'lucide-react';
import { createPageUrl } from '@/utils';
import LoadingSpinner from '../components/shared/LoadingSpinner';
// Living Dashboard system - same family used across the B2B pages.
// Settings is technically a personal-area page, but it sits alongside
// the business pages in the side menu (managers reach BusinessSettings
// from the same nav cluster), so applying the family treatment keeps
// the chrome consistent.
import { PageShell, Card } from '@/components/business/system';

// Reuse existing pages, not lazy. user will browse between tabs, so
// loading all three up front is cheaper than Suspense-flashing on each click.
import UserProfilePage from './UserProfile';
import AccountSettings from './AccountSettings';
import ReminderSettingsPage from './ReminderSettingsPage';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import useIsAdmin from '@/hooks/useIsAdmin';
import { C } from '@/lib/designTokens';

const TABS = [
  { key: 'profile', label: 'פרופיל',   icon: User,  subtitle: 'פרטים אישיים ורישיון נהיגה' },
  { key: 'account', label: 'חשבון משותף', icon: Users, subtitle: 'חברים, רכבים משותפים והזמנות' },
  { key: 'alerts',  label: 'התראות',   icon: Bell,  subtitle: 'מה ומתי לקבל תזכורות' },
];

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const initial = TABS.find(t => t.key === params.get('tab'))?.key || 'profile';
  const [active, setActive] = useState(initial);
  const { isBusiness } = useWorkspaceRole();
  const isAdmin = useIsAdmin() === true;
  // "בטיחות ילדים" (TripGuard) home lives in the התראות tab — a personal/
  // parent feature. Admin-gated during rollout (matches the page's own gate).
  const showSafetyEntry = !isBusiness && isAdmin;

  // When the active workspace is a business account, member management lives
  // in the dedicated business surface (ניהול הצוות), NOT the personal
  // "חשבון משותף" screen — enforce the separation by hiding that tab here.
  const tabs = isBusiness ? TABS.filter(t => t.key !== 'account') : TABS;

  // A deep link to ?tab=account inside a business workspace falls back to
  // the profile tab (the account tab no longer exists in this context).
  useEffect(() => {
    if (isBusiness && active === 'account') setActive('profile');
  }, [isBusiness, active]);

  // Keep the URL in sync so refresh / deep-links land on the same tab.
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (active !== next.get('tab')) {
      next.set('tab', active);
      setParams(next, { replace: true });
    }

  }, [active]);

  const current = tabs.find(t => t.key === active) || tabs[0];

  return (
    <PageShell
      title="הגדרות"
      subtitle={current.subtitle}
    >
      {/* Tab bar — wrapped in a system Card so the surface matches every
          other section in the page below. Active tab uses the system's
          emerald gradient. The "control" container itself sits on a
          mint backdrop to differentiate from the white-card content. */}
      <Card padding="p-1.5" className="mb-4">
        <div
          role="tablist"
          aria-label="הגדרות"
          className="flex items-center gap-1 overflow-x-auto"
        >
          {tabs.map(tab => {
            const isActive = tab.key === active;
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActive(tab.key)}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl whitespace-nowrap transition-all hover:scale-[1.01] active:scale-[0.98]"
                style={{
                  background: isActive
                    ? `linear-gradient(135deg, ${C.successDark} 0%, ${C.successBright} 80%, ${C.successMid} 100%)`
                    : 'transparent',
                  color: isActive ? '#FFFFFF' : C.textAlt,
                  boxShadow: isActive
                    ? '0 4px 12px rgba(16,185,129,0.25)'
                    : 'none',
                  // font-weight kept stable to avoid browser snapping
                  // between loaded faces — visual state is carried by
                  // the gradient + color, not by weight.
                  fontWeight: 700,
                  transition: 'background 180ms cubic-bezier(0.4,0,0.2,1), color 180ms cubic-bezier(0.4,0,0.2,1), box-shadow 180ms cubic-bezier(0.4,0,0.2,1)',
                }}>
                <Icon className="w-4 h-4" strokeWidth={isActive ? 2.4 : 1.8} />
                <span className="text-xs">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Active tab content. The embedded sub-pages render their own
          Cards / sections; this wrapper just hosts them. */}
      <Suspense fallback={<div className="flex justify-center py-16"><LoadingSpinner /></div>}>
        {active === 'profile' && <UserProfilePage embedded />}
        {active === 'account' && !isBusiness && <AccountSettings embedded />}
        {active === 'alerts' && (
          <>
            {showSafetyEntry && (
              <Card className="mb-4">
                <Link to={createPageUrl('SafetyReminder')} className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: C.light }}>
                    <Shield className="h-5 w-5" style={{ color: C.primary }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold" style={{ color: C.text }}>בטיחות ילדים</p>
                    <p className="text-xs" style={{ color: C.muted }}>תזכורת שלא לשכוח ילד ברכב בסוף נסיעה</p>
                  </div>
                  <ChevronLeft className="h-5 w-5 shrink-0" style={{ color: C.muted }} />
                </Link>
              </Card>
            )}
            <ReminderSettingsPage embedded />
          </>
        )}
      </Suspense>

      {/* Version footer — lives at the page level so it shows for every
          tab AND every user, including guests (the embedded UserProfile
          renders a "register to manage" gate for guests instead of the
          full profile, which previously hid the version line at the
          bottom of that page). Critical for support triage: "what build
          is this user on?" is the first question we ask, especially
          right after a Play Store rollout when half the install base
          is on the new version and half isn't. Sourced from
          package.json via the __APP_VERSION__ Vite define. */}
      <p className="text-center text-[11px] mt-6 mb-2" style={{ color: C.gray400 }}>
        CarReminder &middot; גרסה {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '—'}
      </p>
    </PageShell>
  );
}
