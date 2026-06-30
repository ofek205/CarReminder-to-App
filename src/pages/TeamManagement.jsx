/**
 * TeamManagement — business-account members & roles surface (owner/manager).
 *
 * The single place to manage WHO is in a business account and WHAT they may
 * do: invite (email → pending → bell → accept), change role (מנהל ↔ צופה),
 * remove a member (cancels their driver_assignments server-side), and cancel
 * pending invites. Distinct from /Drivers, which owns driver↔vehicle
 * assignment operations; drivers (role) keep the read-only /Team roster.
 *
 * All membership writes go through SECURITY DEFINER RPCs
 * (change_member_role / remove_member / cancel_pending_invite); the owner row
 * is never actionable here, and ownership transfer lives in /BusinessSettings.
 *
 * Spec: docs/spec-business-personal-membership-separation.md §4(א)(ב).
 */
import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Users, Crown, Shield, Eye, Truck, UserPlus, Loader2, Trash2, Clock, Mail,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/supabaseQuery';
import { toastError } from '@/lib/userErrorReport';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { PageShell, Card, KpiTile, AnimatedCount } from '@/components/business/system';
import SystemErrorBanner from '@/components/shared/SystemErrorBanner';
import InviteAccountMemberDialog from '@/components/sharing/InviteAccountMemberDialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { C } from '@/lib/designTokens';

// Account-role vocabulary aligned with permissions.js (בעלים/מנהל/צופה) +
// the fleet 'driver' operational layer (shown distinctly).
const ROLE_META = {
  'בעלים':  { label: 'בעלים', icon: Crown,  accent: 'purple',  cls: 'text-purple-700 bg-purple-50' },
  'מנהל':   { label: 'מנהל',  icon: Shield, accent: 'emerald', cls: 'text-[#2D5233] bg-[#E8F2EA]' },
  'שותף':   { label: 'צופה',  icon: Eye,    accent: 'blue',    cls: 'text-blue-700 bg-blue-50' },
  'driver': { label: 'נהג',   icon: Truck,  accent: 'amber',   cls: 'text-orange-700 bg-orange-50' },
};
const roleMeta = (role) => ROLE_META[role] || { label: role, icon: Users, accent: 'emerald', cls: 'text-gray-700 bg-gray-100' };

const ROLE_ERROR = {
  cannot_remove_owner:      'אי אפשר להסיר את בעל החשבון',
  cannot_change_owner_role: 'אי אפשר לשנות את תפקיד הבעלים',
  not_authorized:           'אין לך הרשאה לפעולה הזו',
  member_not_found:         'איש הצוות לא נמצא',
  use_leave_account:        'כדי לעזוב בעצמך, השתמש/י באפשרות "עזוב חשבון"',
  invite_not_pending:       'ההזמנה כבר אינה ממתינה',
};
const errText = (e, fallback) => {
  const code = (e?.message || '').match(/[a-z_]+/)?.[0] || '';
  return ROLE_ERROR[code] || fallback;
};

export default function TeamManagement() {
  const { isAuthenticated, user, isLoading: authLoading } = useAuth();
  const { accountId } = useAccountRole();
  const { isBusiness, isOwner, isManager, isLoading: roleLoading } = useWorkspaceRole();
  const { activeWorkspace } = useWorkspace();
  const queryClient = useQueryClient();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [busyKey, setBusyKey] = useState(null);        // `${user_id}:${action}` while a mutation runs
  const [confirm, setConfirm] = useState(null);        // { action:'remove'|'cancel', member }

  const enabled = !!accountId && isAuthenticated && isBusiness && isManager;

  const { data: members = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['team-management', accountId],
    queryFn: async () => {
      const { data, error } = await withTimeout(
        supabase.rpc('workspace_team_directory', { p_account_id: accountId }),
        'team_management'
      );
      if (error) throw error;
      return data || [];
    },
    enabled,
    staleTime: 60 * 1000,
    retry: 1,
    retryDelay: 800,
  });

  const { active, pending, sections, counts } = useMemo(() => {
    const act = members.filter(m => m.status === 'פעיל');
    const pend = members.filter(m => m.status === 'ממתין');
    const leadership = act.filter(m => m.role === 'בעלים' || m.role === 'מנהל');
    const viewers    = act.filter(m => m.role === 'שותף');
    const drivers    = act.filter(m => m.role === 'driver');
    return {
      active: act,
      pending: pend,
      sections: [
        { key: 'leadership', title: 'הנהלה', members: leadership },
        { key: 'viewers',    title: 'צופים', members: viewers },
        { key: 'drivers',    title: 'נהגים', members: drivers, note: 'שיבוץ רכבים מתבצע במסך "נהגים"' },
      ].filter(s => s.members.length > 0),
      counts: {
        active: act.length,
        pending: pend.length,
        drivers: drivers.length,
      },
    };
  }, [members]);

  // Who the current user may act on. Never the owner, never self. Owner may
  // act on any non-owner; a manager may not touch other managers (mirrors the
  // server-side rule in remove_member / change_member_role).
  const canActOn = (m) => {
    if (m.role === 'בעלים') return false;
    if (m.user_id === user?.id) return false;
    if (isOwner) return true;
    return m.role !== 'מנהל';
  };

  const runMutation = async (key, fn, okMsg, fallbackErr) => {
    setBusyKey(key);
    try {
      const { error } = await fn();
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['team-management', accountId] });
      if (okMsg) toast.success(okMsg);
    } catch (e) {
      toastError(errText(e, fallbackErr), { action: key, err: e });
    } finally {
      setBusyKey(null);
    }
  };

  const handleChangeRole = (m, newRole) => runMutation(
    `${m.user_id}:role`,
    () => withTimeout(supabase.rpc('change_member_role', {
      p_account_id: accountId, p_member_user_id: m.user_id, p_new_role: newRole,
    }), 'change_member_role'),
    `התפקיד שונה ל${roleMeta(newRole).label}`,
    'שגיאה בשינוי התפקיד',
  );

  const handleRemove = (m) => runMutation(
    `${m.user_id}:remove`,
    () => withTimeout(supabase.rpc('remove_member', {
      p_account_id: accountId, p_member_user_id: m.user_id,
    }), 'remove_member'),
    'איש הצוות הוסר מהחשבון',
    'שגיאה בהסרת איש הצוות',
  );

  const handleCancelPending = (m) => runMutation(
    `${m.user_id}:cancel`,
    () => withTimeout(supabase.rpc('cancel_pending_invite', {
      p_account_id: accountId, p_member_user_id: m.user_id,
    }), 'cancel_pending_invite'),
    'ההזמנה בוטלה',
    'שגיאה בביטול ההזמנה',
  );

  // ---- guards (after hooks, so hook order is stable) ----
  if (authLoading || roleLoading) {
    return <div dir="rtl" className="text-center py-16 text-xs text-gray-400">טוען...</div>;
  }
  if (!isAuthenticated) {
    return <Empty icon={<Users className="h-10 w-10 text-gray-300" />} text="צריך להתחבר כדי לנהל את הצוות." />;
  }
  if (!isBusiness) {
    return <Empty icon={<Users className="h-10 w-10 text-gray-300" />}
      title="ניהול הצוות זמין בחשבון עסקי" text="עבור לחשבון עסקי דרך הסרגל העליון, או צור חשבון חדש." />;
  }
  if (!isManager) {
    return <Empty icon={<Shield className="h-10 w-10 text-gray-300" />}
      title="ניהול הצוות שמור לבעלים ולמנהלים" text="צפייה בצוות זמינה במסך הצוות." />;
  }

  return (
    <PageShell
      title="ניהול הצוות"
      subtitle={activeWorkspace?.account_name || 'חשבון עסקי'}
      actions={(
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
          style={{
            background: `linear-gradient(135deg, ${C.successDark} 0%, ${C.successBright} 80%, ${C.successMid} 100%)`,
            color: '#FFFFFF',
            boxShadow: '0 8px 20px rgba(16,185,129,0.32), 0 2px 6px rgba(16,185,129,0.18)',
          }}
        >
          <UserPlus className="h-4 w-4" />
          הזמן לצוות
        </button>
      )}
    >
      <section className="grid grid-cols-3 gap-3 mb-5">
        <KpiTile label="אנשי צוות" value={<AnimatedCount value={counts.active} />} sub={counts.active === 1 ? 'רק אתה' : 'פעילים'} tone="emerald" />
        <KpiTile label="ממתינים" value={<AnimatedCount value={counts.pending} />} sub={counts.pending === 0 ? 'אין הזמנות' : 'לאישור'} tone="amber" />
        <KpiTile label="נהגים" value={<AnimatedCount value={counts.drivers} />} sub={counts.drivers === 0 ? 'אין נהגים' : 'בצוות'} tone="blue" />
      </section>

      {isLoading ? (
        <Card className="text-center py-10">
          <Loader2 className="h-6 w-6 mx-auto mb-2 animate-spin" style={{ color: C.successBright }} />
          <p className="text-xs" style={{ color: C.mutedAlt }}>טוען את הצוות...</p>
        </Card>
      ) : isError ? (
        <SystemErrorBanner message="טעינת הצוות נכשלה. בדוק את החיבור ונסה שוב." onRetry={() => refetch()} />
      ) : active.length <= 1 && pending.length === 0 ? (
        <Card className="text-center py-12">
          <UserPlus className="h-10 w-10 mx-auto mb-3" style={{ color: C.successLighter }} />
          <p className="text-sm font-bold mb-1" style={{ color: C.primaryDark }}>עדיין רק אתה בצוות</p>
          <p className="text-xs leading-relaxed mb-4" style={{ color: C.mutedAlt }}>
            הזמן את איש הצוות הראשון — הוא יקבל הזמנה לאישור, ואחרי שיאשר יופיע כאן עם התפקיד שבחרת.
          </p>
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold"
            style={{ background: '#FFFFFF', color: C.successBright, border: `1.5px solid ${C.successLight}` }}
          >
            <UserPlus className="h-4 w-4" /> הזמן לצוות
          </button>
        </Card>
      ) : (
        <>
          {sections.map(section => (
            <section key={section.key} className="mb-6">
              <h2 className="flex items-center gap-2 mb-2.5 text-sm font-bold pr-2.5 border-r-2"
                style={{
                  color: C.primaryDark,
                  borderRightColor: section.key === 'leadership' ? '#A855F7'
                    : section.key === 'drivers' ? C.warnIcon : C.info,
                }}>
                {section.title}
                <span className="text-[11px] font-bold rounded-full px-2 py-0.5 tabular-nums"
                  style={{ background: C.bgSubtle, color: C.textAlt }} dir="ltr">
                  {section.members.length}
                </span>
              </h2>
              {section.note && (
                <p className="text-[11px] mb-2 pr-2.5" style={{ color: C.mutedAlt }}>{section.note}</p>
              )}
              <ul className="space-y-2">
                {section.members.map(m => (
                  <MemberRow
                    key={m.user_id}
                    member={m}
                    isSelf={m.user_id === user?.id}
                    actionable={canActOn(m)}
                    busyKey={busyKey}
                    onChangeRole={handleChangeRole}
                    onRemove={(mm) => setConfirm({ action: 'remove', member: mm })}
                  />
                ))}
              </ul>
            </section>
          ))}

          {pending.length > 0 && (
            <section className="mb-6">
              <h2 className="flex items-center gap-2 mb-2.5 text-sm font-bold pr-2.5 border-r-2"
                style={{ color: C.primaryDark, borderRightColor: C.warnIcon }}>
                הזמנות ממתינות
                <span className="text-[11px] font-bold rounded-full px-2 py-0.5 tabular-nums"
                  style={{ background: C.warnSubtle, color: C.warnDark }} dir="ltr">
                  {pending.length}
                </span>
              </h2>
              <ul className="space-y-2">
                {pending.map(m => (
                  <PendingRow
                    key={m.user_id}
                    member={m}
                    busy={busyKey === `${m.user_id}:cancel`}
                    onCancel={(mm) => setConfirm({ action: 'cancel', member: mm })}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <InviteAccountMemberDialog
        open={inviteOpen}
        onOpenChange={(next) => {
          setInviteOpen(next);
          if (!next) refetch();
        }}
        accountId={accountId}
        vehicles={[]}
        businessMode
      />

      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.action === 'remove' ? 'להסיר את איש הצוות?' : 'לבטל את ההזמנה?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.action === 'remove'
                ? `"${confirm?.member?.display_name || 'החבר'}" יאבד גישה לחשבון, וכל שיבוצי הרכב הפעילים שלו יבוטלו.`
                : `ההזמנה ל"${confirm?.member?.display_name || confirm?.member?.email || 'הנמען'}" תבוטל. אפשר להזמין שוב מאוחר יותר.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>חזרה</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const c = confirm;
                setConfirm(null);
                if (c?.action === 'remove') handleRemove(c.member);
                else handleCancelPending(c.member);
              }}
              style={{ background: confirm?.action === 'remove' ? C.error : C.warnMid, color: '#fff' }}
            >
              {confirm?.action === 'remove' ? 'הסר' : 'בטל הזמנה'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

function MemberRow({ member, isSelf, actionable, busyKey, onChangeRole, onRemove }) {
  const meta = roleMeta(member.role);
  const RoleIcon = meta.icon;
  const roleBusy = busyKey === `${member.user_id}:role`;
  const removeBusy = busyKey === `${member.user_id}:remove`;
  // Role toggle only for account-permission members (manager/viewer), not the
  // owner and not drivers (driver role is managed on /Drivers).
  const showRoleToggle = actionable && (member.role === 'מנהל' || member.role === 'שותף');

  return (
    <li>
      <Card accent={meta.accent} padding="p-3.5">
        <div className="flex items-start gap-3">
          <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${meta.cls}`}>
            <RoleIcon className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <p className="text-sm font-bold truncate" style={{ color: C.primaryDark }}>
                {member.display_name}
                {isSelf && (
                  <span className="text-[10px] font-bold mr-2 px-1.5 py-0.5 rounded-md"
                    style={{ background: C.successLight, color: C.successDark }}>אתה</span>
                )}
              </p>
              <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${meta.cls}`}>
                {meta.label}
              </span>
            </div>
            {member.email && (
              <p className="text-[11px] truncate" dir="ltr" style={{ color: C.mutedAlt }}>{member.email}</p>
            )}

            {showRoleToggle && (
              <div className="mt-2 flex items-center gap-1.5">
                <span className="text-[10px] font-bold shrink-0" style={{ color: C.mutedAlt }}>תפקיד:</span>
                {['מנהל', 'שותף'].map(r => {
                  const rm = roleMeta(r);
                  const activeRole = member.role === r;
                  return (
                    <button key={r} type="button" disabled={roleBusy || activeRole}
                      onClick={() => onChangeRole(member, r)}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all disabled:opacity-100"
                      style={{
                        background: activeRole ? C.successSubtle : '#fff',
                        color: activeRole ? C.successDark : C.textAlt,
                        borderColor: activeRole ? C.successLighter : C.bgSage,
                        opacity: roleBusy && !activeRole ? 0.5 : 1,
                      }}>
                      {rm.label}
                    </button>
                  );
                })}
                {roleBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: C.successBright }} />}
              </div>
            )}
          </div>

          {actionable && (
            <button type="button" onClick={() => onRemove(member)} disabled={removeBusy}
              aria-label="הסר איש צוות"
              className="shrink-0 p-2 rounded-lg transition-colors hover:bg-red-50 disabled:opacity-50">
              {removeBusy ? <Loader2 className="h-4 w-4 animate-spin" style={{ color: C.error }} />
                : <Trash2 className="h-4 w-4" style={{ color: C.error }} />}
            </button>
          )}
        </div>
      </Card>
    </li>
  );
}

function PendingRow({ member, busy, onCancel }) {
  return (
    <li>
      <Card accent="amber" padding="p-3.5">
        <div className="flex items-center gap-3">
          <div className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: C.warnSubtle, color: C.warnDark }}>
            <Clock className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <p className="text-sm font-bold truncate" style={{ color: C.primaryDark }}>
                {member.display_name || member.email || 'מוזמן'}
              </p>
              <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold"
                style={{ background: C.warnSubtle, color: C.warnDark }}>
                ממתין · {roleMeta(member.role).label}
              </span>
            </div>
            {member.email && (
              <p className="text-[11px] flex items-center gap-1 truncate" dir="ltr" style={{ color: C.mutedAlt }}>
                <Mail className="h-3 w-3 shrink-0" /> <span className="truncate">{member.email}</span>
              </p>
            )}
          </div>
          <button type="button" onClick={() => onCancel(member)} disabled={busy}
            className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors disabled:opacity-50"
            style={{ background: '#fff', color: C.warnDark, borderColor: C.warnBorder }}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'בטל'}
          </button>
        </div>
      </Card>
    </li>
  );
}

function Empty({ icon, title, text }) {
  return (
    <div dir="rtl" className="max-w-md mx-auto py-16">
      <div className="text-center px-6">
        {icon && <div className="flex justify-center mb-3">{icon}</div>}
        {title && <p className="text-sm font-bold text-gray-700 mb-1">{title}</p>}
        <p className="text-xs text-gray-500 leading-relaxed">{text}</p>
      </div>
    </div>
  );
}
