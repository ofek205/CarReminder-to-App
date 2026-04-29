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

const ROLE_META = {
  'בעלים':  { label: 'בעלים', icon: Crown,  cls: 'text-purple-700 bg-purple-50' },
  'מנהל':   { label: 'מנהל',  icon: Shield, cls: 'text-[#2D5233] bg-[#E8F2EA]' },
  'שותף':   { label: 'צופה',  icon: Eye,    cls: 'text-blue-700 bg-blue-50' },
  'driver': { label: 'נהג',   icon: Truck,  cls: 'text-orange-700 bg-orange-50' },
};
const roleMeta = (role) =>
  ROLE_META[role] || { label: role, icon: Users, cls: 'text-gray-700 bg-gray-100' };

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

  return (
    <div dir="rtl" className="max-w-3xl mx-auto py-2">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">הצוות שלי</h1>
        <p className="text-xs text-gray-500 truncate">
          {workspaceName}
          <span className="text-gray-400">{` · ${team.length} ${team.length === 1 ? 'חבר' : 'חברים'}`}</span>
        </p>
      </div>

      {isLoading ? (
        <p className="text-center text-xs text-gray-400 py-8">טוען...</p>
      ) : teamError ? (
        <Empty
          icon={<Users className="h-10 w-10 text-gray-300" />}
          title="לא הצלחנו לטעון את הצוות"
          text="בדוק את החיבור לאינטרנט ונסה שוב. אם הבעיה נמשכת — צור קשר עם מנהל הצי."
          embedded
        />
      ) : team.length === 0 ? (
        <Empty
          icon={<Users className="h-10 w-10 text-gray-300" />}
          title="אין חברים בצוות"
          text="כשמנהל יוסיף חברים לחשבון, הם יופיעו כאן עם פרטי קשר."
          embedded
        />
      ) : (
        sections.map(section => (
          <section key={section.key} className="mb-5">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">
              {section.title}
              <span className="text-gray-300">{` · ${section.members.length}`}</span>
            </h2>
            <ul className="space-y-2">
              {section.members.map(m => (
                <MemberCard key={m.user_id} member={m} isSelf={m.user_id === user?.id} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function MemberCard({ member, isSelf }) {
  const meta = roleMeta(member.role);
  const RoleIcon = meta.icon;
  return (
    <li className="bg-white border border-gray-100 rounded-xl p-3">
      <div className="flex items-start gap-3">
        <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${meta.cls}`}>
          <RoleIcon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <p className="text-sm font-bold text-gray-900 truncate">
              {member.display_name}
              {isSelf && <span className="text-[10px] font-bold text-gray-400 mr-2">(אתה)</span>}
            </p>
            <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${meta.cls}`}>
              {meta.label}
            </span>
          </div>
          {/* Tap-to-call / tap-to-mail. mailto / tel: hand the action to
              the OS (default phone app on mobile, mail client on
              desktop). Members without a phone simply hide that row —
              we do not coerce a placeholder. */}
          <div className="flex flex-col gap-1 mt-1.5">
            {member.phone && (
              <a
                href={`tel:${member.phone}`}
                className="inline-flex items-center gap-1.5 text-[12px] text-gray-700 hover:text-[#2D5233]"
                dir="ltr"
              >
                <Phone className="h-3 w-3 text-gray-400 shrink-0" />
                {member.phone}
              </a>
            )}
            {member.email && (
              <a
                href={`mailto:${member.email}`}
                className="inline-flex items-center gap-1.5 text-[12px] text-gray-500 hover:text-[#2D5233] truncate"
                dir="ltr"
              >
                <Mail className="h-3 w-3 text-gray-400 shrink-0" />
                <span className="truncate">{member.email}</span>
              </a>
            )}
          </div>
        </div>
      </div>
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
