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
import { User, Users, Bell, Shield, ChevronLeft, UserCog, Briefcase } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { PageShell, Card } from '@/components/business/system';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import useIsAdmin from '@/hooks/useIsAdmin';
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

  const personalRows = [
    { to: 'UserProfile', icon: User, label: 'פרופיל ורישיון', sub: 'פרטים אישיים ורישיון נהיגה' },
    !isBusiness && { to: 'AccountSettings', icon: Users, label: 'חשבון משותף', sub: 'שיתוף רכבים עם בני משפחה' },
    { to: 'ReminderSettingsPage', icon: Bell, label: 'התראות ותזכורות', sub: 'מה ומתי לקבל תזכורות' },
    showSafetyEntry && { to: 'SafetyReminder', icon: Shield, label: 'בטיחות ילדים', sub: 'תזכורת שלא לשכוח ילד ברכב בסוף נסיעה' },
  ].filter(Boolean);

  // Business group — only in a business workspace, gated by role.
  // הצוות: owner+manager · הגדרות העסק (company/drivers/ownership): owner only.
  const businessRows = isBusiness ? [
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

      {/* Version footer — shown for every user (support triage). */}
      <p className="text-center text-[11px] mt-6 mb-2" style={{ color: C.gray400 }}>
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
