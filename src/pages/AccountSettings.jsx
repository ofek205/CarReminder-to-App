import React, { useState } from 'react';
import { db } from '@/lib/supabaseEntities';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/supabaseQuery';
import { MEMBER_STATUS, INVITE_STATUS } from '@/lib/enums';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Users, UserPlus, Trash2, Crown, Shield, User, Eye, Car, ChevronDown, ChevronUp, Link2 } from "lucide-react";
import { toast } from "sonner";
import PageHeader from "../components/shared/PageHeader";
import MobileBackButton from "../components/shared/MobileBackButton";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import InviteAccountMemberDialog from "@/components/sharing/InviteAccountMemberDialog";
import { useAuth } from "../components/shared/GuestContext";
import useAccountRole from "@/hooks/useAccountRole";
import { canManage, isOwner, ROLE_INFO } from "@/lib/permissions";
import { C } from '@/lib/designTokens';
import VehicleAccessModal from "@/components/sharing/VehicleAccessModal";
import SharingHelpButton from "@/components/sharing/SharingHelpButton";
import BlockedUsersList from "@/components/community/BlockedUsersList";

//  Role badge component
function RoleBadge({ role }) {
  const info = ROLE_INFO[role];
  if (!info) return null;
  return (
    <span className="text-sm font-bold px-3 py-1 rounded-full"
      style={{ background: info.bg, color: info.color }}>
      {info.label}
    </span>
  );
}

//  Member card 
function MemberCard({ member, memberEmail, memberName, isMe, canRemove, canChangeRole, onRemove, onRoleChange }) {
  const IconMap = { 'בעלים': Crown, 'מנהל': Shield, 'שותף': User };
  const Icon = IconMap[member.role] || User;
  const info = ROLE_INFO[member.role] || ROLE_INFO['שותף'];
  const [changingRole, setChangingRole] = useState(false);

  const handleRoleChange = async (newRole) => {
    if (newRole === member.role) return;
    setChangingRole(true);
    await onRoleChange(member, newRole);
    setChangingRole(false);
  };

  return (
    <div className="rounded-2xl p-4 mb-3 transition-all"
      style={{ background: '#FFFFFF', border: `1.5px solid ${C.gray200}`, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}
      dir="rtl">
      <div className="flex items-center gap-4">
        {/* Avatar */}
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
          style={{ background: info.bg }}>
          <Icon className="w-6 h-6" style={{ color: info.color }} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-bold text-base text-gray-900 truncate">
              {memberName || 'משתמש'}
            </p>
            {isMe && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">אני</span>
            )}
          </div>
          <p className="text-sm text-gray-500 truncate mt-0.5">{memberEmail || ''}</p>
        </div>

        {/* Role badge + Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <RoleBadge role={member.role} />
          {canRemove && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9">
                  <Trash2 className="h-4 w-4 text-red-400" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent dir="rtl">
                <AlertDialogHeader>
                  <AlertDialogTitle>הסרת משתמש</AlertDialogTitle>
                  <AlertDialogDescription>
                    האם להסיר את {memberName || 'המשתמש'} מהחשבון? לא יוכל לראות את הרכבים שלך.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="flex gap-2">
                  <AlertDialogCancel>ביטול</AlertDialogCancel>
                  <AlertDialogAction onClick={onRemove} className="bg-red-600 hover:bg-red-700">
                    הסר
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* Role change - only shown for non-owner members, only by owner */}
      {canChangeRole && member.role !== 'בעלים' && (
        <div className="mt-3 pt-3 flex items-center gap-2" style={{ borderTop: `1px solid ${C.gray100}` }}>
          <span className="text-xs font-bold text-gray-500 shrink-0">שנה תפקיד:</span>
          <div className="flex gap-1.5 flex-1">
            {['מנהל', 'שותף'].map(r => {
              const rInfo = ROLE_INFO[r];
              const active = member.role === r;
              return (
                <button key={r} onClick={() => handleRoleChange(r)} disabled={changingRole || active}
                  className="flex-1 py-2 rounded-xl text-xs font-bold transition-all border"
                  style={{
                    background: active ? rInfo.bg : C.grayBg,
                    color: active ? rInfo.color : C.gray400,
                    borderColor: active ? rInfo.color : C.gray200,
                    opacity: changingRole ? 0.5 : 1,
                  }}>
                  {rInfo.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

//  Guest view 
function GuestAccountSettings({ embedded = false }) {
  return (
    <div className="px-4 pb-20" dir="rtl">
      {!embedded && <PageHeader title="חשבון משותף" backPage="Settings" />}
      <div className="rounded-3xl p-8 text-center space-y-5"
        style={{ background: C.light, border: `1.5px solid ${C.border}` }}>
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto"
          style={{ background: C.grad }}>
          <Users className="h-10 w-10 text-white" />
        </div>
        <h2 className="font-bold text-xl text-gray-900">שתף את הרכבים שלך</h2>
        <p className="text-base text-gray-500 leading-relaxed">
          הזמן אנשים לצפות ולנהל את הרכבים שלך - בני משפחה, שותפים, או עובדים.
          הירשם כדי להתחיל.
        </p>
        <div className="grid grid-cols-3 gap-3 pt-2">
          {Object.entries(ROLE_INFO).map(([key, info]) => (
            <div key={key} className="rounded-2xl p-3 text-center" style={{ background: info.bg }}>
              <p className="font-bold text-sm" style={{ color: info.color }}>{info.label}</p>
              <p className="text-xs mt-1" style={{ color: info.color, opacity: 0.7 }}>{info.description.split('-')[0]}</p>
            </div>
          ))}
        </div>
        <Button onClick={() => window.location.href = '/Auth'}
          className="w-full h-14 rounded-2xl font-bold text-base gap-2"
          style={{ background: C.grad, color: 'white', boxShadow: `0 6px 24px ${C.primary}40` }}>
          <UserPlus className="h-5 w-5" />
          הירשם בחינם
        </Button>
      </div>
    </div>
  );
}

//  Main 
export default function AccountSettings({ embedded = false }) {
  const { isGuest } = useAuth();
  if (isGuest) return <GuestAccountSettings embedded={embedded} />;
  return <AuthAccountSettings embedded={embedded} />;
}

function AuthAccountSettings({ embedded = false }) {
  const { user } = useAuth();
  const { role: myRole, accountId, isLoading: roleLoading } = useAccountRole();
  const [showInvite, setShowInvite] = useState(false);
  const [invitesExpanded, setInvitesExpanded] = useState(false);
  // Vehicle access modal — opened when the user taps a row in the
  // per-vehicle shares section. Same modal as on VehicleDetail / Cards.
  const [accessModalVehicle, setAccessModalVehicle] = useState(null);
  const queryClient = useQueryClient();

  // Per-vehicle shares feed for this page. Pulls from my_vehicles_v
  // (already exposes share_count + is_shared_with_me) and splits the
  // result into "vehicles I'm sharing" vs "vehicles shared with me".
  // Account-level membership (from account_members) and per-vehicle
  // shares (from vehicle_shares) are presented side-by-side here so
  // the user has one place to see + manage every sharing relation.
  const { data: myVehicles = [] } = useQuery({
    queryKey: ['my-vehicles', user?.id],
    queryFn: async () => {
      const { data, error } = await withTimeout(
        supabase.from('my_vehicles_v').select('*'),
        'my_vehicles_v'
      );
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
    staleTime: 30 * 1000,
  });
  const sharedByMe   = myVehicles.filter(v => !v.is_shared_with_me && (v.share_count || 0) > 0);
  const sharedWithMe = myVehicles.filter(v => v.is_shared_with_me);

  // Fetch vehicles for selection
  const { data: vehicles = [] } = useQuery({
    queryKey: ['account-vehicles', accountId],
    queryFn: () => db.vehicles.filter({ account_id: accountId }, { light: true }),
    enabled: !!accountId,
  });

  // Fetch members
  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ['account-members', accountId],
    queryFn: () => db.account_members.filter({ account_id: accountId, status: MEMBER_STATUS.ACTIVE }),
    enabled: !!accountId,
  });

  // Fetch active invites
  const { data: activeInvites = [] } = useQuery({
    queryKey: ['active-invites', accountId],
    queryFn: () => db.invites.filter({ account_id: accountId, status: INVITE_STATUS.ACTIVE }),
    enabled: !!accountId && canManage(myRole),
  });

  // Member mutations go through SECURITY DEFINER RPCs (not direct
  // db.account_members.update). The RPCs enforce authz server-side, protect
  // the owner row, and — for removal — cancel the member's active
  // driver_assignments in the same transaction. Wrapped in withTimeout so a
  // hung call surfaces an error toast instead of a silent stall.
  const removeMember = async (member) => {
    try {
      const { error } = await withTimeout(
        supabase.rpc('remove_member', {
          p_account_id: accountId,
          p_member_user_id: member.user_id,
        }),
        'remove_member'
      );
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['account-members'] });
      toast.success('המשתמש הוסר מהחשבון');
    } catch (e) {
      const msg = e?.message || '';
      if (msg.includes('cannot_remove_owner')) toast.error('אי אפשר להסיר את בעל החשבון');
      else if (msg.includes('not_authorized')) toast.error('אין לך הרשאה להסיר את החבר הזה');
      else toast.error('שגיאה בהסרת החבר');
    }
  };

  const changeRole = async (member, newRole) => {
    try {
      const { error } = await withTimeout(
        supabase.rpc('change_member_role', {
          p_account_id: accountId,
          p_member_user_id: member.user_id,
          p_new_role: newRole,
        }),
        'change_member_role'
      );
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['account-members'] });
      const roleLabel = ROLE_INFO[newRole]?.label || newRole;
      toast.success(`התפקיד שונה ל${roleLabel}`);
    } catch (e) {
      const msg = e?.message || '';
      if (msg.includes('cannot_change_owner_role')) toast.error('אי אפשר לשנות את תפקיד הבעלים');
      else if (msg.includes('not_authorized')) toast.error('אין לך הרשאה לשנות את התפקיד הזה');
      else toast.error('שגיאה בשינוי התפקיד');
    }
  };

  if (roleLoading || membersLoading) return <LoadingSpinner />;

  return (
    <div className="px-4 pb-20" dir="rtl">
      {!embedded && <MobileBackButton to="Settings" />}
      {/* Header. skip when embedded inside the Settings hub (its tab bar
          already identifies the section). We still show the primary action
          (הזמן משתמש חדש) below the stats row so it doesn't disappear. */}
      {!embedded && (
        <div className="rounded-3xl p-5 mb-6 relative overflow-hidden"
          style={{ background: C.grad, boxShadow: `0 8px 32px ${C.primary}40` }}>
          <div className="absolute -top-10 -left-10 w-40 h-40 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }} />
          <div className="absolute -bottom-6 -right-6 w-28 h-28 rounded-full" style={{ background: 'rgba(255,191,0,0.15)' }} />
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.2)' }}>
                <Users className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="font-bold text-xl text-white">החשבון שלי</h1>
                  <SharingHelpButton size="sm" />
                </div>
                <p className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.75)' }}>
                  {members.length} {members.length === 1 ? 'משתמש' : 'משתמשים'} &bull; {ROLE_INFO[myRole]?.label || myRole}
                </p>
              </div>
            </div>
            {canManage(myRole) && (
              <Button onClick={() => setShowInvite(true)}
                className="w-full h-12 rounded-2xl font-bold text-base gap-2 mt-2"
                style={{ background: C.yellow, color: C.primary }}>
                <UserPlus className="h-5 w-5" />
                הזמן משתמש חדש
              </Button>
            )}
          </div>
        </div>
      )}
      {/* When embedded, surface the invite CTA as a plain pill so users
          can still reach it from inside the tab. */}
      {embedded && canManage(myRole) && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl px-4 py-3"
          style={{ background: C.light, border: `1px solid ${C.border}` }}>
          <div>
            <p className="text-sm font-bold" style={{ color: C.text }}>
              {members.length} {members.length === 1 ? 'משתמש' : 'משתמשים'}
            </p>
            <p className="text-[11px]" style={{ color: C.muted }}>התפקיד שלך: {ROLE_INFO[myRole]?.label || myRole}</p>
          </div>
          <Button onClick={() => setShowInvite(true)}
            className="rounded-xl font-bold gap-2 h-10 px-4"
            style={{ background: C.yellow, color: C.primary }}>
            <UserPlus className="h-4 w-4" />
            הזמן משתמש
          </Button>
        </div>
      )}

      {/* Roles explanation */}
      <div className="mb-6">
        <h2 className="font-bold text-base text-gray-900 mb-3">רמות הרשאה</h2>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(ROLE_INFO).map(([key, info]) => {
            const IconMap = { Crown, Shield, User };
            const Icon = IconMap[info.icon] || User;
            return (
              <div key={key} className="rounded-2xl p-3 text-center" style={{ background: info.bg }}>
                <Icon className="w-5 h-5 mx-auto mb-1.5" style={{ color: info.color }} />
                <p className="font-bold text-sm" style={{ color: info.color }}>{info.label}</p>
                <p className="text-xs mt-1 leading-tight" style={{ color: info.color, opacity: 0.75 }}>
                  {info.description.split('-').pop()?.trim()}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Members list */}
      <div className="mb-6">
        <h2 className="font-bold text-base text-gray-900 mb-3">
          משתמשי החשבון ({members.length})
        </h2>
        {members.map(member => (
          <MemberCard
            key={member.id}
            member={member}
            memberName={member.user_id === user?.id ? (user.full_name || user.email) : (ROLE_INFO[member.role]?.label || 'משתמש')}
            memberEmail={member.user_id === user?.id ? user.email : ''}
            isMe={member.user_id === user?.id}
            canRemove={isOwner(myRole) && member.role !== 'בעלים' && member.user_id !== user?.id}
            canChangeRole={isOwner(myRole) && member.user_id !== user?.id}
            onRemove={() => removeMember(member)}
            onRoleChange={changeRole}
          />
        ))}
      </div>

      {/* Per-vehicle shares — synced from my_vehicles_v. Rendered as
          two stacks (sharing-out + shared-with-me) only when each has
          rows, so a fresh user with no vehicle shares just sees the
          familiar account-level list above. Tapping a row opens the
          shared VehicleAccessModal which already handles owner-revoke
          AND sharee-leave flows. */}
      {(sharedByMe.length > 0 || sharedWithMe.length > 0) && (
        <div className="mb-6 space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-base text-gray-900">רכבים משותפים</h2>
            <SharingHelpButton size="sm" />
          </div>

          {sharedByMe.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-gray-500">רכבים ששיתפתי ({sharedByMe.length})</p>
              {sharedByMe.map(v => {
                const vName = v.nickname || `${v.manufacturer || ''} ${v.model || ''}`.trim() || 'רכב';
                return (
                  <button key={v.id} type="button" onClick={() => setAccessModalVehicle(v)}
                    className="w-full rounded-2xl p-3 text-right flex items-center gap-3 transition-all active:scale-[0.99]"
                    style={{ background: '#fff', border: '1.5px solid #BAE6FD' }}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: '#E0F2FE' }}>
                      <Car className="w-5 h-5" style={{ color: '#075985' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm truncate" style={{ color: C.gray800 }}>{vName}</p>
                      <p className="text-[11px]" style={{ color: '#075985' }}>
                        משותף עם {v.share_count} {v.share_count === 1 ? 'משתמש' : 'משתמשים'}
                      </p>
                    </div>
                    <ChevronDown className="w-4 h-4 text-gray-400 -rotate-90" />
                  </button>
                );
              })}
            </div>
          )}

          {sharedWithMe.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-gray-500">רכבים שמשותפים איתי ({sharedWithMe.length})</p>
              {sharedWithMe.map(v => {
                const vName = v.nickname || `${v.manufacturer || ''} ${v.model || ''}`.trim() || 'רכב';
                const roleLabel = v.share_role === 'editor' ? 'שותף עורך' : 'שותף צופה';
                return (
                  <button key={v.id} type="button" onClick={() => setAccessModalVehicle(v)}
                    className="w-full rounded-2xl p-3 text-right flex items-center gap-3 transition-all active:scale-[0.99]"
                    style={{ background: '#fff', border: `1.5px solid ${C.warnBorder}` }}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: C.warnBg }}>
                      <Car className="w-5 h-5" style={{ color: C.warnDark }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm truncate" style={{ color: C.gray800 }}>{vName}</p>
                      <p className="text-[11px]" style={{ color: C.warnDark }}>{roleLabel}</p>
                    </div>
                    <ChevronDown className="w-4 h-4 text-gray-400 -rotate-90" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal driven by the per-vehicle shares list above. Same
          component used on VehicleDetail / Cards — owner sees revoke
          list, sharee sees the leave-share button. */}
      {accessModalVehicle && (
        <VehicleAccessModal
          open={!!accessModalVehicle}
          onOpenChange={(o) => { if (!o) setAccessModalVehicle(null); }}
          vehicle={accessModalVehicle}
          isOwner={!accessModalVehicle.is_shared_with_me}
        />
      )}

      {/* Active invites. collapsed by default, the row count alone tells
          the user whether they have pending invites out in the wild, and
          tapping expands the full list. */}
      {canManage(myRole) && activeInvites.length > 0 && (
        <div className="mb-6">
          <button
            type="button"
            onClick={() => setInvitesExpanded(v => !v)}
            aria-expanded={invitesExpanded}
            className="w-full flex items-center justify-between rounded-2xl px-4 py-3 transition-colors"
            style={{ background: C.warnBg, border: `1px solid ${C.warnBorder}` }}>
            <div className="flex items-center gap-2.5">
              <Link2 className="w-5 h-5 text-amber-600" />
              <div className="text-right">
                <p className="font-bold text-sm text-amber-900">
                  הזמנות פעילות ({activeInvites.length})
                </p>
                <p className="text-[11px] text-amber-700">
                  {invitesExpanded ? 'לחץ לכיווץ' : 'לחץ לראות פרטים'}
                </p>
              </div>
            </div>
            {invitesExpanded ? (
              <ChevronUp className="w-4 h-4 text-amber-600" />
            ) : (
              <ChevronDown className="w-4 h-4 text-amber-600" />
            )}
          </button>
          {invitesExpanded && (
            <div className="mt-2 space-y-2">
              {activeInvites.map(invite => (
                <div key={invite.id} className="rounded-2xl p-3.5 flex items-center justify-between"
                  style={{ background: C.warnBg, border: `1px solid ${C.warnBorder}` }} dir="rtl">
                  <div className="flex items-center gap-3 min-w-0">
                    <Link2 className="w-4 h-4 text-amber-600 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-bold text-sm text-amber-900 truncate">
                        הזמנה כ{invite.role_to_assign}
                      </p>
                      <p className="text-xs text-amber-700">
                        פג תוקף {new Date(invite.expires_at).toLocaleDateString('he-IL')}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-amber-600 px-2 py-1 rounded-full bg-amber-100 shrink-0">
                    {invite.uses_count}/{invite.max_uses}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* View-only banner for members */}
      {myRole === 'שותף' && (
        <div className="rounded-2xl p-4 flex items-center gap-3 mb-6"
          style={{ background: C.infoBg, border: '1px solid #93C5FD' }} dir="rtl">
          <Eye className="w-5 h-5 text-blue-600 shrink-0" />
          <p className="text-sm font-bold text-blue-800">
            הצטרפת כשותף - תצוגה בלבד. לא ניתן לערוך או למחוק.
          </p>
        </div>
      )}

      {/* Blocked users management. Mounts the community block list inside the
          account settings tab so the user has a single place to see (and undo)
          their blocks. Required by Apple Guideline 1.2 — once a user can block
          someone, they must be able to unblock them. */}
      <div className="mt-6" dir="rtl">
        <BlockedUsersList />
      </div>

      <InviteAccountMemberDialog
        open={showInvite}
        onOpenChange={setShowInvite}
        accountId={accountId}
        vehicles={vehicles}
      />
    </div>
  );
}
