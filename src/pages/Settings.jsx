/**
 * Settings — unified hub (grouped navigation list, drill-down).
 *
 * ONE settings entry for the whole app. The hub is a grouped index that
 * adapts to the active workspace (WorkspaceSwitcher):
 *   - "אישי"  : profile, shared account (personal only), alerts, child-safety
 *   - "עסקי"  : team, business settings — shown only in a business workspace,
 *               labelled with the business name, gated by role.
 * Each row drills into its existing screen. This replaces the old tab hub and
 * the separate "הגדרות עסקיות" side-menu line, so personal vs business is
 * unmistakable and there's never a confusing second settings entry.
 *
 * Old deep-links (/UserProfile, /AccountSettings, /ReminderSettingsPage,
 * /BusinessSettings, ?tab=…) still resolve — the hub just links to them.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { User, Users, Bell, Shield, ChevronLeft, UserCog, Briefcase, Sparkles, CreditCard } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { PageShell, Card } from '@/components/business/system';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import useIsAdmin from '@/hooks/useIsAdmin';
import { useFeatureFlag } from '@/lib/featureFlags';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { C } from '@/lib/designTokens';

export default function Settings() {
  const { isBusiness, isOwner, isManager } = useWorkspaceRole();
  const { activeWorkspace } = useWorkspace();
  const isAdmin = useIsAdmin() === true;

  const businessName = activeWorkspace?.account_name || 'העסק';
  // "בטיחות ילדים" (TripGuard) — personal/parent feature, admin-gated during
  // rollout (matches the page's own gate). Hidden in a business workspace.
  const showSafetyEntry = !isBusiness && isAdmin;

  // "המסלול והחיוב" (monetization phase 2). Flag-gated because the screen
  // reads plan_limits and account_subscriptions, which do not exist until
  // supabase-monetization-phase1-plans-2026-09-08.sql has been applied:
  // without the gate every user would find a row leading to an error state.
  // defaultOnError stays false (the helper's default) so a flag read that
  // fails hides the row rather than exposing a broken screen.
  //
  // ⚠️ "המסלול והחיוב", not "מנוי". Everyone is on the free plan today, and
  // "subscription" implies they are paying for something.
  const { enabled: planUiEnabled } = useFeatureFlag('monetization_ui_enabled');

  const planRow = planUiEnabled
    ? { to: 'MyPlan', icon: CreditCard, label: 'המסלול והחיוב', sub: 'המסלול הנוכחי, המגבלות והניצול' }
    : null;

  const personalRows = [
    // First in the group when shown: the plan is per ACCOUNT, and the
    // active workspace is what decides which account this is.
    !isBusiness && planRow,
    { to: 'UserProfile', icon: User, label: 'פרופיל ורישיון', sub: 'פרטים אישיים ורישיון נהיגה' },
    !isBusiness && { to: 'AccountSettings', icon: Users, label: 'חשבון משותף', sub: 'שיתוף רכבים עם בני משפחה' },
    { to: 'ReminderSettingsPage', icon: Bell, label: 'התראות ותזכורות', sub: 'מה ומתי לקבל תזכורות' },
    // Not admin-gated and not behind the ai_consent_enforced flag: this is
    // where a consent gets WITHDRAWN, so it has to be reachable whenever a
    // consent can exist. Gating it would make refusing the sheet a one-way
    // door for anyone who reached it before the gate opened.
    { to: 'AiServices', icon: Sparkles, label: 'שירותי AI', sub: 'מה מותר לשלוח לשירותי ה-AI' },
    showSafetyEntry && { to: 'SafetyReminder', icon: Shield, label: 'בטיחות ילדים', sub: 'תזכורת שלא לשכוח ילד ברכב בסוף נסיעה' },
  ].filter(Boolean);

  // Business group — only in a business workspace, gated by role.
  // הצוות: owner+manager · הגדרות העסק (company/drivers/ownership): owner only.
  const businessRows = isBusiness ? [
    // Same row, in the business group, when a business workspace is active.
    // It appears in exactly one group at a time, so there is never a second
    // plan entry to disagree with the first.
    planRow,
    isManager && { to: 'TeamManagement', icon: UserCog, label: 'הצוות', sub: 'הזמנה, תפקידים והסרת חברים' },
    isOwner   && { to: 'BusinessSettings', icon: Briefcase, label: 'הגדרות העסק', sub: 'פרטי החברה, נהגים ובעלות' },
  ].filter(Boolean) : [];

  const showGroupHeaders = businessRows.length > 0;

  return (
    <PageShell
      title="הגדרות"
      subtitle={isBusiness ? businessName : 'ניהול החשבון וההעדפות שלך'}
    >
      <SettingsGroup title={showGroupHeaders ? 'אישי' : null} rows={personalRows} />

      {businessRows.length > 0 && (
        <SettingsGroup title={`עסקי · ${businessName}`} rows={businessRows} accent />
      )}

      {/* Legal documents: App Store Guideline 5.1.1(i) requires the privacy
          policy to be reachable "within the app in an easily accessible
          manner", and until now the only link lived on AuthPage, so a
          signed-in user had no path to it at all.
          These are reference documents rather than settings, so they sit in
          the footer instead of the grouped list above. Both routes are in
          PUBLIC_PAGES, so guests reach them too. Padding keeps each tap
          target ~44px for thumb reach. */}
      <nav
        className="flex items-center justify-center gap-0.5 mt-6"
        aria-label="מסמכים משפטיים"
      >
        <Link
          to={createPageUrl('PrivacyPolicy')}
          className="px-3 py-2.5 text-[13px] underline rounded-lg transition-colors hover:bg-gray-50"
          style={{ color: C.mutedAlt }}
        >
          מדיניות פרטיות
        </Link>
        <span className="text-[13px]" aria-hidden="true" style={{ color: C.gray300 }}>&middot;</span>
        <Link
          to={createPageUrl('TermsOfService')}
          className="px-3 py-2.5 text-[13px] underline rounded-lg transition-colors hover:bg-gray-50"
          style={{ color: C.mutedAlt }}
        >
          תנאי שימוש
        </Link>
      </nav>

      {/* Version footer — shown for every user (support triage). */}
      <p className="text-center text-[11px] mt-1 mb-2" style={{ color: C.gray400 }}>
        CarReminder &middot; גרסה {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '—'}
      </p>
    </PageShell>
  );
}

function SettingsGroup({ title, rows, accent }) {
  return (
    <section className="mb-5">
      {title && (
        <h2
          className="flex items-center gap-2 mb-2 text-sm font-bold pr-2.5 border-r-2"
          style={{ color: C.primaryDark, borderRightColor: accent ? C.successBright : C.gray300 }}
        >
          {title}
        </h2>
      )}
      <Card padding="p-1.5">
        {rows.map((r, i) => {
          const Icon = r.icon;
          return (
            <Link
              key={r.to}
              to={createPageUrl(r.to)}
              className="flex items-center gap-3 p-2.5 rounded-xl transition-colors hover:bg-gray-50 active:scale-[0.99]"
              style={i > 0 ? { borderTop: `1px solid ${C.gray100}` } : undefined}
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: accent ? C.successLight : C.light }}
              >
                <Icon className="h-5 w-5" style={{ color: accent ? C.successDark : C.primary }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate" style={{ color: C.text }}>{r.label}</p>
                <p className="text-xs truncate" style={{ color: C.muted }}>{r.sub}</p>
              </div>
              <ChevronLeft className="h-5 w-5 shrink-0" style={{ color: C.gray400 }} />
            </Link>
          );
        })}
      </Card>
    </section>
  );
}
