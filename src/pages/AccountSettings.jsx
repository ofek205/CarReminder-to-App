import React, { useState } from 'react';
import { db } from '@/lib/supabaseEntities';
import { supabase } from '@/lib/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Users, UserPlus, Copy, Trash2, Crown, Shield, User, Loader2, Share2, MessageCircle, Check, Link2, ChevronLeft, Eye, Car, ChevronDown, ChevronUp, Mail, Send } from "lucide-react";
import { toast } from "sonner";
import PageHeader from "../components/shared/PageHeader";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import { useAuth } from "../components/shared/GuestContext";
import useAccountRole from "@/hooks/useAccountRole";
import { canManage, canDelete, isOwner, ROLE_INFO } from "@/lib/permissions";
import { isNative } from "@/lib/capacitor";
import { C } from '@/lib/designTokens';

//  WhatsApp icon 
const WhatsAppIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

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
  const IconMap = { 'בעלים': Crown, 'מנהל': Shield, 'חבר': User };
  const Icon = IconMap[member.role] || User;
  const info = ROLE_INFO[member.role] || ROLE_INFO['חבר'];
  const [changingRole, setChangingRole] = useState(false);

  const handleRoleChange = async (newRole) => {
    if (newRole === member.role) return;
    setChangingRole(true);
    await onRoleChange(member, newRole);
    setChangingRole(false);
  };

  return (
    <div className="rounded-2xl p-4 mb-3 transition-all"
      style={{ background: '#FFFFFF', border: '1.5px solid #E5E7EB', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}
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
            <p className="font-extrabold text-base text-gray-900 truncate">
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
                  <AlertDialogTitle>הסרת חבר</AlertDialogTitle>
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
        <div className="mt-3 pt-3 flex items-center gap-2" style={{ borderTop: '1px solid #F3F4F6' }}>
          <span className="text-xs font-bold text-gray-500 shrink-0">שנה תפקיד:</span>
          <div className="flex gap-1.5 flex-1">
            {['מנהל', 'שותף'].map(r => {
              const rInfo = ROLE_INFO[r];
              const active = member.role === r;
              return (
                <button key={r} onClick={() => handleRoleChange(r)} disabled={changingRole || active}
                  className="flex-1 py-2 rounded-xl text-xs font-bold transition-all border"
                  style={{
                    background: active ? rInfo.bg : '#FAFAFA',
                    color: active ? rInfo.color : '#9CA3AF',
                    borderColor: active ? rInfo.color : '#E5E7EB',
                    opacity: changingRole ? 0.5 : 1,
                  }}>
                  {r === 'מנהל' ? 'מנהל (עריכה)' : 'שותף (צפייה)'}
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
      {!embedded && <PageHeader title="חשבון משותף" />}
      <div className="rounded-3xl p-8 text-center space-y-5"
        style={{ background: C.light, border: `1.5px solid ${C.border}` }}>
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto"
          style={{ background: C.grad }}>
          <Users className="h-10 w-10 text-white" />
        </div>
        <h2 className="font-black text-xl text-gray-900">שתף את הרכבים שלך</h2>
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
  const [inviteRole, setInviteRole] = useState('שותף');
  const [invitesExpanded, setInvitesExpanded] = useState(false);
  const [inviteeEmail, setInviteeEmail] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [creating, setCreating] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [shareAll, setShareAll] = useState(true); // true = all vehicles, false = specific
  const [selectedVehicleIds, setSelectedVehicleIds] = useState([]);
  const queryClient = useQueryClient();

  // Fetch vehicles for selection
  const { data: vehicles = [] } = useQuery({
    queryKey: ['account-vehicles', accountId],
    queryFn: () => db.vehicles.filter({ account_id: accountId }),
    enabled: !!accountId,
  });

  // Fetch members
  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ['account-members', accountId],
    queryFn: () => db.account_members.filter({ account_id: accountId, status: 'פעיל' }),
    enabled: !!accountId,
  });

  // Fetch active invites
  const { data: activeInvites = [] } = useQuery({
    queryKey: ['active-invites', accountId],
    queryFn: () => db.invites.filter({ account_id: accountId, status: 'פעיל' }),
    enabled: !!accountId && canManage(myRole),
  });

  //  Create invite 
  const createInvite = async () => {
    setCreating(true);
    setLinkCopied(false);
    try {
      const arr = new Uint8Array(32);
      crypto.getRandomValues(arr);
      const token = Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
      const expires = new Date();
      expires.setDate(expires.getDate() + 7);

      if (!accountId || !user?.id) {
        toast.error('שגיאה: חשבון לא נמצא. נסה לרענן.');
        setCreating(false);
        return;
      }

      await db.invites.create({
        account_id: accountId,
        invited_by_user_id: user.id,
        role_to_assign: inviteRole,
        token,
        expires_at: expires.toISOString(),
        max_uses: 1,
        uses_count: 0,
        status: 'פעיל',
        vehicle_ids: shareAll ? null : selectedVehicleIds,
      });

      // Use public production URL for share links (works on WhatsApp, etc.)
      const PUBLIC_DOMAIN = 'https://car-reminder.app';
      const origin = (typeof window !== 'undefined' && window.location.origin && window.location.origin.startsWith('http') && !window.location.origin.includes('localhost'))
        ? window.location.origin
        : PUBLIC_DOMAIN;
      const link = `${origin}/JoinInvite?token=${token}`;
      setInviteLink(link);
      queryClient.invalidateQueries({ queryKey: ['active-invites'] });
      toast.success('ההזמנה נוצרה בהצלחה');

      // If the user entered an email, fire off the invite mail in the background.
      // We don't block on it. the user already has the link they can copy /
      // share on WhatsApp. The email is just a convenience.
      if (inviteeEmail && inviteeEmail.includes('@')) {
        sendInviteEmail(link).catch(() => { /* already handled inside */ });
      }
    } catch (e) {
      if (import.meta.env.DEV) console.error('Invite creation error:', e);
      toast.error('שגיאה ביצירת ההזמנה. נסה שוב.');
    } finally {
      setCreating(false);
    }
  };

  // Send the invite link to the invitee by email via the Resend-backed
  // Edge Function. The actual sending lives in src/lib/sendEmail.js.
  const sendInviteEmail = async (link) => {
    if (!inviteeEmail) return;
    setEmailSending(true);
    try {
      const { sendEmail, sendTemplatedEmail } = await import('@/lib/sendEmail');
      const inviterName = user?.full_name || user?.email || 'משתמש CarReminder';
      const roleLabel = inviteRole; // 'מנהל' / 'שותף'

      // Primary path: DB-managed template (admin editable via /EmailCenter).
      // Falls back to the in-code builder if the feature flag is off, the
      // template row is missing, or the DB lookup errors. Keeps the invite
      // flow working end-to-end even mid-migration.
      try {
        await sendTemplatedEmail('invite', {
          to: inviteeEmail,
          vars: { inviterName, roleLabel, inviteLink: link },
        });
      } catch (e) {
        if (e.name === 'EmailsPausedError') throw e;          // bubble up
        if (import.meta.env.DEV) console.warn('DB template path failed, falling back:', e.message);
        const { buildInviteEmail, buildInviteText } = await import('@/lib/emailTemplates');
        const subject = `${inviterName} הזמין/ה אותך ל-CarReminder`;
        const html = buildInviteEmail({ inviterName, roleLabel, inviteLink: link });
        const text = buildInviteText({ inviterName, roleLabel, inviteLink: link });
        await sendEmail({ to: inviteeEmail, subject, html, text });
      }

      setEmailSent(true);
      toast.success(`המייל נשלח ל-${inviteeEmail}`);
    } catch (e) {
      if (import.meta.env.DEV) console.error('Invite email send error:', e);
      const msg = e.name === 'EmailsPausedError'
        ? 'שליחת מיילים מושעתה על ידי אדמין'
        : 'שליחת המייל נכשלה. אפשר לשתף דרך WhatsApp או להעתיק את הקישור.';
      toast.error(msg);
    } finally {
      setEmailSending(false);
    }
  };

  const copyLink = async () => {
    const { copyToClipboard } = await import('@/lib/clipboard');
    const ok = await copyToClipboard(inviteLink);
    if (ok) {
      setLinkCopied(true);
      toast.success('הקישור הועתק');
      setTimeout(() => setLinkCopied(false), 3000);
    } else {
      toast.error('לא ניתן להעתיק');
    }
  };

  const shareWhatsApp = () => {
    const roleLabel = inviteRole === 'מנהל' ? 'מנהל' : 'חבר';
    // Put link at end, preceded by a space (not newline). WhatsApp parses better
    const text = `הצטרף/י לחשבון הרכבים שלי ב-CarReminder כ${roleLabel}. לחץ להצטרפות: ${inviteLink}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const shareNative = async () => {
    if (isNative) {
      try {
        const { shareContent } = await import('@/lib/capacitor');
        await shareContent({
          title: 'הזמנה ל-CarReminder',
          text: `הצטרף/י לחשבון הרכבים שלי ב-CarReminder`,
          url: inviteLink,
        });
      } catch { /* cancelled */ }
    } else if (navigator.share) {
      try {
        await navigator.share({
          title: 'הזמנה ל-CarReminder',
          text: `הצטרף/י לחשבון הרכבים שלי`,
          url: inviteLink,
        });
      } catch { /* cancelled */ }
    }
  };

  const removeMember = async (member) => {
    await db.account_members.update(member.id, { status: 'הוסר' });
    queryClient.invalidateQueries({ queryKey: ['account-members'] });
    toast.success('החבר הוסר');
  };

  const changeRole = async (member, newRole) => {
    try {
      await db.account_members.update(member.id, { role: newRole });
      queryClient.invalidateQueries({ queryKey: ['account-members'] });
      const roleLabel = ROLE_INFO[newRole]?.label || newRole;
      toast.success(`התפקיד שונה ל${roleLabel}`);
    } catch (e) {
      toast.error('שגיאה בשינוי התפקיד');
    }
  };

  const resetInviteDialog = () => {
    setShowInvite(false);
    setInviteLink('');
    setLinkCopied(false);
    setInviteRole('שותף');
    setShareAll(true);
    setSelectedVehicleIds([]);
    setInviteeEmail('');
    setEmailSending(false);
    setEmailSent(false);
  };

  const toggleVehicle = (vId) => {
    setSelectedVehicleIds(prev =>
      prev.includes(vId) ? prev.filter(id => id !== vId) : [...prev, vId]
    );
  };

  if (roleLoading || membersLoading) return <LoadingSpinner />;

  return (
    <div className="px-4 pb-20" dir="rtl">
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
              <div>
                <h1 className="font-black text-xl text-white">החשבון שלי</h1>
                <p className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.75)' }}>
                  {members.length} {members.length === 1 ? 'חבר' : 'חברים'} &bull; {myRole}
                </p>
              </div>
            </div>
            {canManage(myRole) && (
              <Button onClick={() => setShowInvite(true)}
                className="w-full h-12 rounded-2xl font-bold text-base gap-2 mt-2"
                style={{ background: '#FFBF00', color: C.primary }}>
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
              {members.length} {members.length === 1 ? 'חבר' : 'חברים'}
            </p>
            <p className="text-[11px]" style={{ color: C.muted }}>התפקיד שלך: {myRole}</p>
          </div>
          <Button onClick={() => setShowInvite(true)}
            className="rounded-xl font-bold gap-2 h-10 px-4"
            style={{ background: '#FFBF00', color: C.primary }}>
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
          חברי החשבון ({members.length})
        </h2>
        {members.map(member => (
          <MemberCard
            key={member.id}
            member={member}
            memberName={member.user_id === user?.id ? (user.full_name || user.email) : 'חבר'}
            memberEmail={member.user_id === user?.id ? user.email : ''}
            isMe={member.user_id === user?.id}
            canRemove={isOwner(myRole) && member.role !== 'בעלים' && member.user_id !== user?.id}
            canChangeRole={isOwner(myRole) && member.user_id !== user?.id}
            onRemove={() => removeMember(member)}
            onRoleChange={changeRole}
          />
        ))}
      </div>

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
            style={{ background: '#FEF3C7', border: '1px solid #FDE68A' }}>
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
                  style={{ background: '#FEF3C7', border: '1px solid #FDE68A' }} dir="rtl">
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
          style={{ background: '#DBEAFE', border: '1px solid #93C5FD' }} dir="rtl">
          <Eye className="w-5 h-5 text-blue-600 shrink-0" />
          <p className="text-sm font-bold text-blue-800">
            הצטרפת כשותף - תצוגה בלבד. לא ניתן לערוך או למחוק.
          </p>
        </div>
      )}

      {/* Invite Dialog */}
      <Dialog open={showInvite} onOpenChange={resetInviteDialog}>
        <DialogContent className="max-w-md mx-4" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">הזמנת חבר חדש</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 pt-2">
            {/* Role selection */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">בחר רמת הרשאה</label>
              <div className="space-y-2.5">
                {[
                  { value: 'מנהל', icon: Shield, title: 'מנהל - עריכה מלאה', desc: 'הוספה, עריכה ומחיקה של רכבים, טיפולים ומסמכים. לא יכול לנהל משתמשים.' },
                  { value: 'שותף', icon: Eye, title: 'שותף - צפייה בלבד', desc: 'יכול לראות את הרכבים והנתונים, אבל לא לערוך או למחוק.' },
                ].map(opt => {
                  const active = inviteRole === opt.value;
                  const info = ROLE_INFO[opt.value];
                  return (
                    <button key={opt.value} type="button"
                      onClick={() => setInviteRole(opt.value)}
                      className="w-full rounded-2xl p-4 text-right transition-all border-2 flex items-start gap-3"
                      style={{
                        borderColor: active ? info.color : '#E5E7EB',
                        background: active ? info.bg : '#FAFAFA',
                      }}>
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                        style={{ background: active ? `${info.color}20` : '#F3F4F6' }}>
                        <opt.icon className="w-5 h-5" style={{ color: info.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm" style={{ color: active ? info.color : '#374151' }}>{opt.title}</p>
                        <p className="text-xs mt-0.5 leading-relaxed" style={{ color: '#6B7280' }}>{opt.desc}</p>
                      </div>
                      {active && (
                        <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-1"
                          style={{ background: info.color }}>
                          <Check className="w-4 h-4 text-white" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Vehicle selection */}
            {vehicles.length > 0 && !inviteLink && (
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">אילו רכבים לשתף?</label>
                <div className="space-y-2">
                  {/* All vehicles option */}
                  <button type="button" onClick={() => { setShareAll(true); setSelectedVehicleIds([]); }}
                    className="w-full rounded-2xl p-3 text-right transition-all border-2 flex items-center gap-3"
                    style={{
                      borderColor: shareAll ? C.primary : '#E5E7EB',
                      background: shareAll ? C.light : '#FAFAFA',
                    }}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{ background: shareAll ? C.primary : '#F3F4F6' }}>
                      <Users className="w-4 h-4" style={{ color: shareAll ? 'white' : '#9CA3AF' }} />
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-sm" style={{ color: shareAll ? C.primary : '#6B7280' }}>כל הרכבים</p>
                      <p className="text-xs" style={{ color: '#9CA3AF' }}>גישה לכל הרכבים בחשבון</p>
                    </div>
                    {shareAll && <Check className="w-5 h-5" style={{ color: C.primary }} />}
                  </button>

                  {/* Specific vehicles option */}
                  <button type="button" onClick={() => setShareAll(false)}
                    className="w-full rounded-2xl p-3 text-right transition-all border-2 flex items-center gap-3"
                    style={{
                      borderColor: !shareAll ? C.primary : '#E5E7EB',
                      background: !shareAll ? C.light : '#FAFAFA',
                    }}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{ background: !shareAll ? C.primary : '#F3F4F6' }}>
                      <Car className="w-4 h-4" style={{ color: !shareAll ? 'white' : '#9CA3AF' }} />
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-sm" style={{ color: !shareAll ? C.primary : '#6B7280' }}>רכבים ספציפיים</p>
                      <p className="text-xs" style={{ color: '#9CA3AF' }}>בחר אילו רכבים לשתף</p>
                    </div>
                    {!shareAll && <Check className="w-5 h-5" style={{ color: C.primary }} />}
                  </button>
                </div>

                {/* Vehicle checkboxes - shown only when "specific" is selected */}
                {!shareAll && (
                  <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto rounded-2xl p-2"
                    style={{ background: '#F9FAFB', border: '1px solid #E5E7EB' }}>
                    {vehicles.map(v => {
                      const vName = v.nickname || [v.manufacturer, v.model].filter(Boolean).join(' ') || 'רכב';
                      const selected = selectedVehicleIds.includes(v.id);
                      return (
                        <button key={v.id} type="button" onClick={() => toggleVehicle(v.id)}
                          className="w-full rounded-xl p-2.5 flex items-center gap-3 transition-all"
                          style={{
                            background: selected ? '#E8F5E9' : 'white',
                            border: `1.5px solid ${selected ? '#4CAF50' : '#E5E7EB'}`,
                          }}>
                          <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-gray-100">
                            {v.vehicle_photo ? (
                              <img src={v.vehicle_photo} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Car className="w-4 h-4 text-gray-400" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 text-right min-w-0">
                            <p className="font-bold text-sm text-gray-900 truncate">{vName}</p>
                            <p className="text-xs text-gray-500">{v.license_plate || ''}</p>
                          </div>
                          <div className="w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0"
                            style={{
                              borderColor: selected ? '#4CAF50' : '#D1D5DB',
                              background: selected ? '#4CAF50' : 'white',
                            }}>
                            {selected && <Check className="w-3 h-3 text-white" />}
                          </div>
                        </button>
                      );
                    })}
                    {selectedVehicleIds.length === 0 && (
                      <p className="text-xs text-center text-red-500 font-medium py-1">בחר לפחות רכב אחד</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Optional email. if provided, we ALSO send the invite link
                by email once the invite is created. WhatsApp/Copy still work
                afterwards, so the email is purely a convenience. */}
            {!inviteLink && (
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  שלח במייל (אופציונלי)
                </label>
                <div className="relative">
                  <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  <input
                    type="email"
                    value={inviteeEmail}
                    onChange={e => setInviteeEmail(e.target.value)}
                    placeholder="friend@example.com"
                    dir="ltr"
                    className="w-full h-11 pr-9 pl-3 rounded-xl border text-sm font-medium outline-none transition-all focus:ring-2"
                    style={{ background: '#fff', borderColor: '#E5E7EB', color: '#1F2937', '--tw-ring-color': C.primary }}
                  />
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5">
                  אם תזין מייל, נשלח את קישור ההזמנה ישירות ל-inbox של המוזמן.
                </p>
              </div>
            )}

            {!inviteLink ? (
              <Button onClick={createInvite} disabled={creating || (!shareAll && selectedVehicleIds.length === 0)}
                className="w-full h-12 rounded-2xl font-bold text-base gap-2"
                style={{ background: C.grad, color: 'white', opacity: (!shareAll && selectedVehicleIds.length === 0) ? 0.5 : 1 }}>
                {creating ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                  <>
                    <Link2 className="h-5 w-5" />
                    {inviteeEmail && inviteeEmail.includes('@') ? 'צור קישור ושלח במייל' : 'צור קישור הזמנה'}
                  </>
                )}
              </Button>
            ) : (
              <div className="space-y-3">
                {/* Link preview */}
                <div className="rounded-2xl p-3 flex items-center gap-2"
                  style={{ background: '#F0FDF4', border: '1.5px solid #BBF7D0' }}>
                  <Check className="w-5 h-5 text-green-600 shrink-0" />
                  <p className="text-sm font-bold text-green-800">הקישור מוכן! תקף 7 ימים</p>
                </div>

                {/* Email status. only shown when the user typed an email upfront.
                    Sending happens in the background after invite creation. */}
                {inviteeEmail && (
                  <div className="rounded-2xl p-3 flex items-center gap-2"
                    style={{
                      background: emailSent ? '#EFF6FF' : emailSending ? '#FFFBEB' : '#FEF2F2',
                      border: `1.5px solid ${emailSent ? '#BFDBFE' : emailSending ? '#FDE68A' : '#FECACA'}`,
                    }}>
                    {emailSending ? <Loader2 className="w-4 h-4 animate-spin text-amber-600 shrink-0" />
                      : emailSent ? <Mail className="w-4 h-4 text-blue-600 shrink-0" />
                      : <Mail className="w-4 h-4 text-red-500 shrink-0" />}
                    <p className="text-xs font-bold flex-1" style={{
                      color: emailSent ? '#1E40AF' : emailSending ? '#92400E' : '#991B1B',
                    }}>
                      {emailSending ? 'שולח מייל...'
                        : emailSent ? `המייל נשלח ל-${inviteeEmail}`
                        : 'שליחת המייל נכשלה'}
                    </p>
                    {!emailSending && !emailSent && (
                      <button onClick={() => sendInviteEmail(inviteLink)}
                        className="text-[11px] font-bold text-red-700 underline">נסה שוב</button>
                    )}
                  </div>
                )}

                {/* Share buttons */}
                <div className="grid grid-cols-1 gap-2.5">
                  {/* WhatsApp - primary */}
                  <Button onClick={shareWhatsApp}
                    className="w-full h-12 rounded-2xl font-bold text-base gap-2.5"
                    style={{ background: '#25D366', color: 'white' }}>
                    <WhatsAppIcon />
                    שתף ב-WhatsApp
                  </Button>

                  {/* Email. post-hoc option for users who didn't fill the
                      email field upfront. Shown only when no email was
                      entered + sent yet. */}
                  {!inviteeEmail && (
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                        <input
                          type="email"
                          value={inviteeEmail}
                          onChange={e => setInviteeEmail(e.target.value)}
                          placeholder="שלח לכתובת מייל"
                          dir="ltr"
                          className="w-full h-12 pr-9 pl-3 rounded-2xl border-2 text-sm font-medium outline-none"
                          style={{ background: '#fff', borderColor: '#E5E7EB' }}
                        />
                      </div>
                      <Button
                        onClick={() => sendInviteEmail(inviteLink)}
                        disabled={!inviteeEmail || !inviteeEmail.includes('@') || emailSending}
                        className="h-12 rounded-2xl font-bold px-4"
                        style={{ background: C.primary, color: 'white' }}>
                        {emailSending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                      </Button>
                    </div>
                  )}

                  {/* Copy link */}
                  <Button onClick={copyLink} variant="outline"
                    className="w-full h-12 rounded-2xl font-bold text-base gap-2 border-2">
                    {linkCopied ? <Check className="h-5 w-5 text-green-600" /> : <Copy className="h-5 w-5" />}
                    {linkCopied ? 'הועתק!' : 'העתק קישור'}
                  </Button>

                  {/* Native share - always show on mobile */}
                  <Button onClick={shareNative} variant="outline"
                    className="w-full h-12 rounded-2xl font-bold text-base gap-2 border-2">
                    <Share2 className="h-5 w-5" />
                    שתף באפליקציה אחרת
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
