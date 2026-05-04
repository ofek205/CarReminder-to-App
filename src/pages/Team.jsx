/**
 * Driver-facing Team page — read-only roster of the workspace.
 *
 * Drivers need a single place to find a colleague's phone or email
 * without bothering the manager every time. This page surfaces the
 * full member list (owner + managers + drivers) with role pills and
 * tappable phone / email rows. Managers + viewers fall back to the
 * existing /Drivers page (which has assignment controls); drivers
 * (no canManageRoutes) are kept on this lighter read-only view.
 */
import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Users, Crown, Shield, Eye, Truck, Phone, Mail, Briefcase,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import { useWorkspace } from '@/contexts/WorkspaceContext';
// Living Dashboard system - shared with all B2B pages.
import {
  PageShell,
  Card,
  KpiTile,
  AnimatedCount,
} from '@/components/business/system';

// Role meta keeps the original avatar chip (cls) so the tiny role icon
// retains its identity, plus an `accent` keyed to the Living Dashboard
// palette so each member card gets a domain-keyed top stripe.
const ROLE_META = {
  'בעלים':  { label: 'בעלים', icon: Crown,  accent: 'purple',  cls: 'text-purple-700 bg-purple-50' },
  'מנהל':   { label: 'מנהל',  icon: Shield, accent: 'emerald', cls: 'text-[#2D5233] bg-[#E8F2EA]' },
  'שותף':   { label: 'צופה',  icon: Eye,    accent: 'blue',    cls: 'text-blue-700 bg-blue-50' },
  'driver': { label: 'נהג',   icon: Truck,  accent: 'amber',   cls: 'text-orange-700 bg-orange-50' },
};
const roleMeta = (role) =>
  ROLE_META[role] || { label: role, icon: Users, accent: 'emerald', cls: 'text-gray-700 bg-gray-100' };

export default function Team() {
  const { isAuthenticated, user, isLoading: authLoading } = useAuth();
  const { accountId } = useAccountRole();
  const { isBusiness, isLoading: roleLoading } = useWorkspaceRole();
  const { activeWorkspace } = useWorkspace();
  const enabled = !!accountId && isAuthenticated && isBusiness;

  const { data: team = [], isLoading, error: teamError } = useQuery({
    queryKey: ['workspace-team', accountId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('workspace_team_directory', {
        p_account_id: accountId,
      });
      if (error) throw error;
      return data || [];
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    // Without retry the first transient 502 leaves the team page on
    // a permanent spinner. 1 retry + 800ms exponential keeps it
    // honest without delaying the genuine-error case too long.
    retry: 1,
    retryDelay: 800,
  });

  // Group by role bucket so the page reads top-down: leadership first,
  // then drivers. Within each bucket the RPC already orders by
  // joined_at asc.
  const sections = useMemo(() => {
    const leadership = team.filter(m => m.role === 'בעלים' || m.role === 'מנהל');
    const viewers   = team.filter(m => m.role === 'שותף');
    const drivers   = team.filter(m => m.role === 'driver');
    return [
      { key: 'leadership', title: 'הנהלה',  members: leadership },
      { key: 'drivers',    title: 'נהגים',  members: drivers   },
      { key: 'viewers',    title: 'צופים',  members: viewers   },
    ].filter(s => s.members.length > 0);
  }, [team]);

  if (authLoading || roleLoading) {
    return <div dir="rtl" className="text-center py-16 text-xs text-gray-400">טוען...</div>;
  }
  if (!isAuthenticated) {
    return <Empty text="צריך להתחבר כדי לראות את הצוות." />;
  }
  if (!isBusiness) {
    return (
      <Empty
        icon={<Briefcase className="h-10 w-10 text-gray-300" />}
        title="הצוות זמין רק בחשבון עסקי"
        text="עבור לחשבון עסקי דרך הסרגל העליון."
      />
    );
  }

  const workspaceName = activeWorkspace?.account_name || 'חשבון עסקי';

  // Counts per role bucket — drives the KPI strip headline numbers.
  const counts = {
    total:      team.length,
    leadership: team.filter(m => m.role === 'בעלים' || m.role === 'מנהל').length,
    drivers:    team.filter(m => m.role === 'driver').length,
    viewers:    team.filter(m => m.role === 'שותף').length,
  };

  return (
    <PageShell
      title="הצוות שלי"
      subtitle={workspaceName}
    >
      {/* KPI Strip — team at a glance. Tones match the role accents
          used by each member card below, so the headline number and
          its bucket below are visually linked. */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <KpiTile
          label="סה״כ חברים"
          value={<AnimatedCount value={counts.total} />}
          sub={counts.total === 1 ? 'חבר אחד בחשבון' : 'אנשים בחשבון'}
          tone="emerald"
        />
        <KpiTile
          label="הנהלה"
          value={<AnimatedCount value={counts.leadership} />}
          sub={counts.leadership === 0 ? 'אין מנהלים' : 'בעלים ומנהלים'}
          tone="purple"
        />
        <KpiTile
          label="נהגים"
          value={<AnimatedCount value={counts.drivers} />}
          sub={counts.drivers === 0 ? 'עוד אין נהגים' : 'מבצעי משימות'}
          tone="amber"
        />
        <KpiTile
          label="צופים"
          value={<AnimatedCount value={counts.viewers} />}
          sub={counts.viewers === 0 ? 'אין צופים בחשבון' : 'גישת קריאה בלבד'}
          tone="blue"
        />
      </section>

      {isLoading ? (
        <Card className="text-center py-8">
          <p className="text-xs" style={{ color: '#6B7C72' }}>טוען...</p>
        </Card>
      ) : teamError ? (
        <Card className="text-center py-12">
          <Users className="h-10 w-10 mx-auto mb-3" style={{ color: '#FCA5A5' }} />
          <p className="text-sm font-bold mb-1" style={{ color: '#0B2912' }}>לא הצלחנו לטעון את הצוות</p>
          <p className="text-xs leading-relaxed" style={{ color: '#6B7C72' }}>
            בדוק את החיבור לאינטרנט ונסה שוב. אם הבעיה נמשכת, צור קשר עם מנהל הצי.
          </p>
        </Card>
      ) : team.length === 0 ? (
        <Card className="text-center py-12">
          <Users className="h-10 w-10 mx-auto mb-3" style={{ color: '#A7F3D0' }} />
          <p className="text-sm font-bold mb-1" style={{ color: '#0B2912' }}>אין חברים בצוות</p>
          <p className="text-xs leading-relaxed" style={{ color: '#6B7C72' }}>
            כשמנהל יוסיף חברים לחשבון, הם יופיעו כאן עם פרטי קשר.
          </p>
        </Card>
      ) : (
        sections.map(section => (
          <section key={section.key} className="mb-6">
            {/* Section label — soft accent ribbon on the right edge that
                ties to the role's color, no all-caps tracking-wider
                (Hebrew has no capitals; tracking on Hebrew creates
                tension that doesn't help scanning). */}
            <h2
              className="flex items-center gap-2 mb-2.5 text-sm font-bold pr-2.5 border-r-2"
              style={{
                color: '#0B2912',
                borderRightColor: section.key === 'leadership' ? '#A855F7'
                  : section.key === 'drivers' ? '#F59E0B'
                  : '#3B82F6',
              }}
            >
              {section.title}
              <span
                className="text-[11px] font-bold rounded-full px-2 py-0.5 tabular-nums"
                style={{ background: '#F0F7F4', color: '#4B5D52' }}
                dir="ltr"
              >
                {section.members.length}
              </span>
            </h2>
            <ul className="space-y-2">
              {section.members.map(m => (
                <MemberCard key={m.user_id} member={m} isSelf={m.user_id === user?.id} />
              ))}
            </ul>
          </section>
        ))
      )}
    </PageShell>
  );
}

function MemberCard({ member, isSelf }) {
  const meta = roleMeta(member.role);
  const RoleIcon = meta.icon;
  return (
    <li>
      <Card
        accent={meta.accent}
        padding="p-3.5"
        // The "this is you" highlight is a soft emerald ring + warmer
        // base shadow rather than the standard mint-shadow Card carries.
        // Subtle enough that it doesn't shout; firm enough that scanning
        // a long roster you find yourself instantly.
        style={isSelf ? {
          boxShadow: '0 0 0 2px #10B981, 0 4px 16px rgba(16,185,129,0.18)',
          background: 'linear-gradient(180deg, #F0FDF6 0%, #FFFFFF 60%)',
        } : undefined}
      >
        <div className="flex items-start gap-3">
          <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${meta.cls}`}>
            <RoleIcon className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <p className="text-sm font-bold truncate" style={{ color: '#0B2912' }}>
                {member.display_name}
                {isSelf && (
                  <span
                    className="text-[10px] font-bold mr-2 px-1.5 py-0.5 rounded-md"
                    style={{ background: '#D1FAE5', color: '#065F46' }}
                  >
                    אתה
                  </span>
                )}
              </p>
              <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${meta.cls}`}>
                {meta.label}
              </span>
            </div>
            {/* Tap-to-call / tap-to-mail. mailto / tel: hand the action to
                the OS (default phone app on mobile, mail client on
                desktop). Members without a phone simply hide that row —
                we do not coerce a placeholder. Each contact row gets a
                generous touch target (min 36px tall) for thumb use. */}
            <div className="flex flex-col gap-1 mt-1.5">
              {member.phone && (
                <a
                  href={`tel:${member.phone}`}
                  className="inline-flex items-center gap-1.5 text-[12px] py-1 rounded-md transition-colors hover:bg-emerald-50/60"
                  dir="ltr"
                  style={{ color: '#0B2912' }}
                >
                  <Phone className="h-3.5 w-3.5 shrink-0" style={{ color: '#10B981' }} />
                  <span className="tabular-nums">{member.phone}</span>
                </a>
              )}
              {member.email && (
                <a
                  href={`mailto:${member.email}`}
                  className="inline-flex items-center gap-1.5 text-[12px] py-1 rounded-md transition-colors hover:bg-emerald-50/60 truncate"
                  dir="ltr"
                  style={{ color: '#4B5D52' }}
                >
                  <Mail className="h-3.5 w-3.5 shrink-0" style={{ color: '#10B981' }} />
                  <span className="truncate">{member.email}</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </Card>
    </li>
  );
}

function Empty({ icon, title, text, embedded }) {
  return (
    <div dir="rtl" className={embedded ? 'py-10' : 'max-w-md mx-auto py-16'}>
      <div className="text-center px-6">
        {icon && <div className="flex justify-center mb-3">{icon}</div>}
        {title && <p className="text-sm font-bold text-gray-700 mb-1">{title}</p>}
        <p className="text-xs text-gray-500 leading-relaxed">{text}</p>
      </div>
    </div>
  );
}
