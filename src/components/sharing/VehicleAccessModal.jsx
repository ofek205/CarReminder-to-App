/**
 * VehicleAccessModal — "who has access" + revoke / leave management.
 *
 * Two roles:
 *   - Owner: sees the full sharee list with status badges (pending/
 *     accepted) + a "ביטול שיתוף" button per row that fires
 *     `revoke_vehicle_share`. Confirmation dialog before the call.
 *   - Sharee: sees only their own access entry + a "עזיבת השיתוף"
 *     button that fires `leave_vehicle_share`.
 *
 * Data comes from the `list_vehicle_shares(p_vehicle_id)` RPC for
 * owners; for sharees we don't need the list, just self-leave.
 */

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Users, Eye, Edit, Edit3, Clock, Trash2, LogOut, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { C } from '@/lib/designTokens';
import ShareVehicleDialog from './ShareVehicleDialog';

// Role metadata — keyed by the DB-stored Hebrew strings the
// list_vehicle_shares RPC actually returns (not the legacy
// 'editor'/'viewer' strings). 'מנהל' = editor (can edit), 'שותף' =
// viewer (read-only). Falls back to viewer if the role string is
// unexpected so the badge never renders blank.
const ROLE_META = {
  'מנהל': { label: 'שותף עורך',  Icon: Edit, color: '#2D5233', bg: '#E8F5E9', other: 'שותף',  otherLabel: 'שותף צופה' },
  'שותף': { label: 'שותף צופה',  Icon: Eye,  color: '#1565C0', bg: '#E3F2FD', other: 'מנהל',  otherLabel: 'שותף עורך' },
};

const STATUS_META = {
  pending:  { label: 'ממתין/ה',   color: '#92400E', bg: '#FEF3C7' },
  accepted: { label: 'פעיל',       color: '#1B5E20', bg: '#DCFCE7' },
};

export default function VehicleAccessModal({
  open,
  onOpenChange,
  vehicle,
  // True when the viewer is the vehicle owner. Drives whether we
  // show the full sharee list + revoke buttons, or just the
  // self-leave button.
  isOwner,
}) {
  const queryClient = useQueryClient();
  const [confirmRevoke, setConfirmRevoke] = useState(null); // { share_id, name }
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Role-change confirm. { share_id, name, currentRole, currentLabel,
  // newRole, newLabel } — drives the "switch X to viewer/editor?"
  // alert. Owner-only path; sharee can't change roles.
  const [confirmRoleChange, setConfirmRoleChange] = useState(null);
  // Inline "share with another user" — opens the same ShareVehicleDialog
  // used elsewhere in the app, so the owner can invite from inside the
  // access modal without bouncing back to the vehicle detail screen.
  // Lazy-mounted on first click to avoid pulling the dialog's deps
  // into the modal's first paint.
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [working, setWorking] = useState(false);

  const vehicleName = vehicle?.nickname
    || `${vehicle?.manufacturer || ''} ${vehicle?.model || ''}`.trim()
    || 'הרכב';

  // Owners get the list of all sharees. Sharees don't query the list —
  // RLS would block it anyway (list_vehicle_shares checks ownership).
  const { data: shares = [], isLoading } = useQuery({
    queryKey: ['vehicle-shares', vehicle?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_vehicle_shares', { p_vehicle_id: vehicle.id });
      if (error) throw error;
      return data || [];
    },
    enabled: !!vehicle?.id && !!isOwner && open,
    staleTime: 30 * 1000,
  });

  // Sharee-only: who shared this vehicle with me? Drives the
  // "השיתוף ממוצע מ-{name}" line in the sharee block. Cross-user name
  // lookup needs an RPC because user_profiles RLS only exposes the
  // caller's own row. Returns null silently if the RPC isn't deployed
  // or the caller lacks access — UI just falls back to the generic
  // copy in that case.
  const { data: ownerName = null } = useQuery({
    queryKey: ['vehicle-owner-name', vehicle?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_vehicle_owner_name', { p_vehicle_id: vehicle.id });
      if (error) return null;
      return data || null;
    },
    enabled: !!vehicle?.id && !isOwner && open,
    staleTime: 5 * 60 * 1000,
  });

  const handleRevoke = async () => {
    if (!confirmRevoke) return;
    setWorking(true);
    try {
      const { error } = await supabase.rpc('revoke_vehicle_share', { p_share_id: confirmRevoke.share_id });
      if (error) throw error;
      toast.success('השיתוף בוטל');
      // Refetch share list + vehicle list to reflect immediately.
      setConfirmRevoke(null);
      // Refetch the list + the global "my vehicles" query so the change
      // reflects immediately on Dashboard / Vehicles.
      queryClient.invalidateQueries({ queryKey: ['vehicle-shares', vehicle.id] });
      // Bump the per-vehicle share-info cache so the count pill in
      // VehicleDetail's hero header refreshes without staleTime delay.
      queryClient.invalidateQueries({ queryKey: ['vehicle-share-info', vehicle.id] });
      queryClient.invalidateQueries({ queryKey: ['my-vehicles'] });
    } catch (e) {
      toast.error(`שגיאה בביטול: ${e?.message || 'נסה שוב'}`);
    } finally {
      setWorking(false);
    }
  };

  const handleRoleChange = async () => {
    if (!confirmRoleChange) return;
    setWorking(true);
    try {
      const { error } = await supabase.rpc('update_vehicle_share_role', {
        p_share_id: confirmRoleChange.share_id,
        p_role:     confirmRoleChange.newRole,
      });
      if (error) throw error;
      toast.success(`ההרשאה של ${confirmRoleChange.name} עודכנה ל${confirmRoleChange.newLabel}`);
      setConfirmRoleChange(null);
      // Refetch share list. The recipient's app_notification + bell ping
      // is handled server-side inside the RPC, so realtime kicks in for
      // them without further client work here.
      queryClient.invalidateQueries({ queryKey: ['vehicle-shares', vehicle.id] });
      queryClient.invalidateQueries({ queryKey: ['vehicle-share-info', vehicle.id] });
    } catch (e) {
      const msg = e?.message || '';
      const friendly =
        msg.includes('forbidden')         ? 'רק הבעלים יכול לשנות הרשאות'
        : msg.includes('share_not_active') ? 'אפשר לשנות הרשאה רק על שיתוף פעיל'
        : msg.includes('share_not_found')  ? 'השיתוף כבר לא קיים'
        : `שגיאה בעדכון: ${msg || 'נסה שוב'}`;
      toast.error(friendly);
    } finally {
      setWorking(false);
    }
  };

  const handleLeave = async () => {
    setWorking(true);
    try {
      const { error } = await supabase.rpc('leave_vehicle_share', { p_vehicle_id: vehicle.id });
      if (error) throw error;
      toast.success('יצאת מהשיתוף');
      setConfirmLeave(false);
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ['my-vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['vehicle-share-info', vehicle.id] });
    } catch (e) {
      toast.error(`שגיאה בעזיבה: ${e?.message || 'נסה שוב'}`);
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md mx-4 max-h-[80vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black flex items-center gap-2">
              <Users className="w-5 h-5" style={{ color: C.primary }} />
              שיתופים של {vehicleName}
            </DialogTitle>
          </DialogHeader>

          {!isOwner ? (
            //  Sharee view — only self-leave option
            <div className="space-y-4 pt-2">
              <div className="rounded-2xl p-4" style={{ background: '#FEF3C7', border: '1.5px solid #FDE68A' }}>
                <p className="text-sm font-bold" style={{ color: '#92400E' }}>הרכב הזה שותף איתך</p>
                <p className="text-xs mt-1" style={{ color: '#B45309' }}>
                  {/* Show the owner's full name when we have it — closes
                      the "who shared this with me?" question before any
                      destructive action. Falls back to the gendered
                      generic phrasing if the RPC returned null (RPC not
                      yet deployed, or caller doesn't have access). */}
                  {ownerName
                    ? <><strong>{ownerName}</strong> שיתף/ה איתך את הרכב, ואפשר לעזוב את השיתוף מתי שרוצים.</>
                    : <>הבעלים שיתף/ה אותו איתך, ואפשר לעזוב את השיתוף מתי שרוצים.</>}
                </p>
              </div>
              <Button
                onClick={() => setConfirmLeave(true)}
                variant="outline"
                className="w-full rounded-2xl h-12 gap-2 font-bold"
                style={{ color: '#DC2626', borderColor: '#FECACA' }}>
                <LogOut className="w-4 h-4" />
                יציאה מהשיתוף
              </Button>
            </div>
          ) : (
            //  Owner view — full list with revoke
            <div className="space-y-3 pt-2">
              {isLoading ? (
                <div className="py-10 flex justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : shares.length === 0 ? (
                <div className="py-8 text-center rounded-2xl" style={{ background: '#F9FAFB' }}>
                  <Users className="w-10 h-10 mx-auto mb-2" style={{ color: '#9CA3AF' }} />
                  <p className="text-sm font-bold text-gray-600">עוד אין שיתופים</p>
                  <p className="text-xs mt-1 text-gray-400">אפשר להזמין מישהו ולשתף איתו את הרכב</p>
                </div>
              ) : (
                <>
                  {/* Header strip: simple share count + always-visible
                      invite CTA. The previous "X מתוך 3 (המקסימום)"
                      copy advertised the cap to every owner — Ofek
                      asked we drop it: most owners never approach the
                      ceiling. The 3-share cap is still enforced
                      server-side; a 4th attempt surfaces a friendly
                      Hebrew toast from ShareVehicleDialog. */}
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-gray-500">
                      {shares.length === 1 ? 'שיתוף אחד' : `${shares.length} שיתופים`}
                    </p>
                    <button
                      onClick={() => setShowShareDialog(true)}
                      className="text-xs font-bold px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition-all active:scale-95"
                      style={{ background: '#F59E0B', color: '#fff', boxShadow: '0 2px 6px rgba(245,158,11,0.35)' }}>
                      <Plus className="w-3.5 h-3.5" />
                      הזמן עוד משתמש
                    </button>
                  </div>

                  {shares.map(s => {
                    const roleMeta = ROLE_META[s.role] || ROLE_META['שותף'];
                    const statusMeta = STATUS_META[s.status] || STATUS_META.pending;
                    const RoleIcon = roleMeta.Icon;
                    // Role-edit guard — only meaningful for accepted
                    // shares (pending = not yet using the role; if owner
                    // wants to change it before acceptance they can
                    // revoke + re-invite at the new role). Pending
                    // shares show the role as a static label.
                    const canEditRole = s.status === 'accepted' && roleMeta.other;
                    return (
                      // One full card per sharee. Three vertical zones:
                      //   1. avatar + name/email + status badge
                      //   2. role line + "שנה הרשאה" button (text+icon)
                      //   3. "הסר את השיתוף" full-width destructive button
                      // Every action is a TEXT-LABELED button (icon alone
                      // was the source of confusion — the older user
                      // could not tell the eye / refresh icons were
                      // tappable controls).
                      <div key={s.id} className="rounded-2xl p-4"
                        style={{ background: '#FFF', border: '1.5px solid #E5E7EB' }}>
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                            style={{ background: roleMeta.bg }}>
                            <RoleIcon className="w-5 h-5" style={{ color: roleMeta.color }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-sm truncate" style={{ color: '#1F2937' }}>{s.shared_with_name}</p>
                            {s.shared_with_email && s.shared_with_email !== s.shared_with_name && (
                              <p className="text-[11px] text-gray-400 mt-0.5 truncate" dir="ltr">{s.shared_with_email}</p>
                            )}
                          </div>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1 shrink-0"
                            style={{ background: statusMeta.bg, color: statusMeta.color }}>
                            {s.status === 'pending' && <Clock className="w-2.5 h-2.5" />}
                            {statusMeta.label}
                          </span>
                        </div>

                        {/* Role line + change button. Reads top-to-bottom
                            in plain Hebrew: "הרשאה: <role label>" with
                            a tappable "שנה הרשאה" pill on the same row.
                            The pill carries an Edit3 pencil icon AND
                            the word "שנה" — never icon alone. */}
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <span className="text-xs">
                            <span className="text-gray-500">הרשאה: </span>
                            <strong style={{ color: roleMeta.color }}>{roleMeta.label}</strong>
                          </span>
                          {canEditRole && (
                            <button
                              onClick={() => setConfirmRoleChange({
                                share_id:     s.id,
                                name:         s.shared_with_name,
                                currentRole:  s.role,
                                currentLabel: roleMeta.label,
                                newRole:      roleMeta.other,
                                newLabel:     roleMeta.otherLabel,
                              })}
                              className="text-xs font-bold px-3 py-1.5 rounded-xl inline-flex items-center gap-1.5 transition-all hover:brightness-95 active:scale-95"
                              style={{ background: '#F0FDF4', color: C.primary, border: `1px solid #BBF7D0` }}>
                              <Edit3 className="w-3.5 h-3.5" />
                              שנה הרשאה
                            </button>
                          )}
                        </div>

                        {/* Destructive remove. Full width so it's
                            unambiguous and reachable on mobile, with
                            both the trash icon AND the words
                            "הסר את השיתוף" — Ofek's UX ask was for the
                            non-tech user to recognize this immediately
                            without inferring meaning from an icon. */}
                        <button
                          onClick={() => setConfirmRevoke({ share_id: s.id, name: s.shared_with_name })}
                          className="mt-3 w-full py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                          style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}
                          aria-label={`הסר את השיתוף עם ${s.shared_with_name}`}>
                          <Trash2 className="w-4 h-4" />
                          הסר את השיתוף
                        </button>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Revoke confirm */}
      <AlertDialog open={!!confirmRevoke} onOpenChange={(o) => !o && setConfirmRevoke(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>לבטל את השיתוף עם {confirmRevoke?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              הרכב יוסר מהרשימה שלהם והם לא יראו עוד את הנתונים. תמיד אפשר לשתף שוב.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex gap-2 justify-end">
            <AlertDialogCancel disabled={working}>חזרה</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevoke} disabled={working} className="bg-red-600 hover:bg-red-700">
              {working ? <Loader2 className="w-4 h-4 animate-spin" /> : 'בטל שיתוף'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Leave confirm (sharee) */}
      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>לצאת משיתוף הרכב?</AlertDialogTitle>
            <AlertDialogDescription>
              הרכב יוסר מהרשימה שלך. הבעלים והמשתתפים האחרים ימשיכו לראות אותו כרגיל. חזרה תתאפשר רק אם הבעלים ישתף/תשתף אותך מחדש.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex gap-2 justify-end">
            <AlertDialogCancel disabled={working}>חזרה</AlertDialogCancel>
            <AlertDialogAction onClick={handleLeave} disabled={working} className="bg-red-600 hover:bg-red-700">
              {working ? <Loader2 className="w-4 h-4 animate-spin" /> : 'יציאה'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Role-change confirm — same alert pattern as revoke/leave so
          the user gets the same visual rhythm. The action is reversible
          (one click swaps it back) so the dialog is a confirm-then-go
          rather than a destructive-warning. */}
      <AlertDialog open={!!confirmRoleChange} onOpenChange={(o) => !o && setConfirmRoleChange(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              לשנות את ההרשאה של {confirmRoleChange?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              ההרשאה תשתנה מ־<strong>{confirmRoleChange?.currentLabel}</strong>
              {' '}ל־<strong>{confirmRoleChange?.newLabel}</strong>.
              {' '}
              {confirmRoleChange?.newRole === 'מנהל'
                ? 'הוא יוכל להוסיף ולעדכן הכל חוץ ממחיקת הרכב.'
                : 'הוא יוכל רק לצפות, לא לערוך.'}
              {' '}תקבל/י התראה על השינוי.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex gap-2 justify-end">
            <AlertDialogCancel disabled={working}>חזרה</AlertDialogCancel>
            <AlertDialogAction onClick={handleRoleChange} disabled={working}
              style={{ background: C.primary }}>
              {working ? <Loader2 className="w-4 h-4 animate-spin" /> : 'אישור השינוי'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Inline ShareVehicleDialog — opened by "הזמן עוד משתמש".
          Lazy-mounted so the modal's first paint stays light. The
          dialog's onOpenChange closes both itself AND drops back to
          the access modal afterwards. */}
      {showShareDialog && (
        <ShareVehicleDialog
          open={showShareDialog}
          onOpenChange={(o) => {
            setShowShareDialog(o);
            if (!o) {
              // Refresh the share list — the user may have just added
              // someone new and expects to see them in the list.
              queryClient.invalidateQueries({ queryKey: ['vehicle-shares', vehicle?.id] });
              queryClient.invalidateQueries({ queryKey: ['vehicle-share-info', vehicle?.id] });
            }
          }}
          vehicle={vehicle}
        />
      )}
    </>
  );
}
