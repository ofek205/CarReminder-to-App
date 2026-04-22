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
import { useSearchParams } from 'react-router-dom';
import { User, Users, Bell } from 'lucide-react';
import PageHeader from '../components/shared/PageHeader';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { C } from '@/lib/designTokens';

// Reuse existing pages, not lazy. user will browse between tabs, so
// loading all three up front is cheaper than Suspense-flashing on each click.
import UserProfilePage from './UserProfile';
import AccountSettings from './AccountSettings';
import ReminderSettingsPage from './ReminderSettingsPage';

const TABS = [
  { key: 'profile', label: 'פרופיל',   icon: User,  subtitle: 'פרטים אישיים ורישיון נהיגה' },
  { key: 'account', label: 'חשבון',    icon: Users, subtitle: 'חברים, תפקידים והזמנות' },
  { key: 'alerts',  label: 'התראות',   icon: Bell,  subtitle: 'מה ומתי לקבל תזכורות' },
];

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const initial = TABS.find(t => t.key === params.get('tab'))?.key || 'profile';
  const [active, setActive] = useState(initial);

  // Keep the URL in sync so refresh / deep-links land on the same tab.
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (active !== next.get('tab')) {
      next.set('tab', active);
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const current = TABS.find(t => t.key === active) || TABS[0];

  return (
    <div dir="rtl" className="pb-20">
      <PageHeader title="הגדרות" subtitle={current.subtitle} />

      {/*  Tab bar  */}
      <div className="px-4 mb-5">
        <div
          role="tablist"
          aria-label="הגדרות"
          className="flex items-center gap-1 p-1 rounded-2xl overflow-x-auto"
          style={{ background: C.light, border: `1px solid ${C.border}` }}>
          {TABS.map(tab => {
            const isActive = tab.key === active;
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActive(tab.key)}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl active:scale-[0.98] whitespace-nowrap"
                style={{
                  background: isActive ? '#fff' : 'transparent',
                  boxShadow: isActive ? '0 2px 8px rgba(45,82,51,0.12)' : 'none',
                  color: isActive ? C.primary : C.muted,
                  // Keep weight stable. font-weight doesn't animate smoothly
                  // between 600 and 800 (browsers snap to nearest loaded face).
                  // Color + background + icon stroke now carry the active state.
                  fontWeight: 700,
                  transition: 'background-color 180ms cubic-bezier(0.4,0,0.2,1), color 180ms cubic-bezier(0.4,0,0.2,1), box-shadow 180ms cubic-bezier(0.4,0,0.2,1)',
                }}>
                <Icon className="w-4 h-4" strokeWidth={isActive ? 2.4 : 1.8} />
                <span className="text-xs">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/*  Active tab content  */}
      <div className="px-4">
        <Suspense fallback={<div className="flex justify-center py-16"><LoadingSpinner /></div>}>
          {active === 'profile' && <UserProfilePage embedded />}
          {active === 'account' && <AccountSettings embedded />}
          {active === 'alerts'  && <ReminderSettingsPage embedded />}
        </Suspense>
      </div>
    </div>
  );
}
