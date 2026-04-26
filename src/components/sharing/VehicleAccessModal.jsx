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
import { Loader2, Users, Eye, Edit, Clock, UserMinus, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { C } from '@/lib/designTokens';

const ROLE_META = {
  editor: { label: 'עורך',  Icon: Edit, color: '#2D5233', bg: '#E8F5E9' },
  viewer: { label: 'צופה',  Icon: Eye,  color: '#1565C0', bg: '#E3F2FD' },
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
                  <p className="text-xs font-bold text-gray-500">
                    {shares.length} מתוך 3 שיתופים (המקסימום)
                  </p>
                  {shares.map(s => {
                    const roleMeta = ROLE_META[s.role] || ROLE_META.viewer;
                    const statusMeta = STATUS_META[s.status] || STATUS_META.pending;
                    const RoleIcon = roleMeta.Icon;
                    return (
                      <div key={s.id} className="rounded-2xl p-3 flex items-center gap-3"
                        style={{ background: '#FFF', border: '1.5px solid #E5E7EB' }}>
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                          style={{ background: roleMeta.bg }}>
                          <RoleIcon className="w-5 h-5" style={{ color: roleMeta.color }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm truncate" style={{ color: '#1F2937' }}>{s.shared_with_name}</p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                              style={{ background: roleMeta.bg, color: roleMeta.color }}>
                              {roleMeta.label}
                            </span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                              style={{ background: statusMeta.bg, color: statusMeta.color }}>
                              {s.status === 'pending' && <Clock className="w-2.5 h-2.5" />}
                              {statusMeta.label}
                            </span>
                          </div>
                          {s.shared_with_email && s.shared_with_email !== s.shared_with_name && (
                            <p className="text-[11px] text-gray-400 mt-1 truncate" dir="ltr">{s.shared_with_email}</p>
                          )}
                        </div>
                        <button
                          onClick={() => setConfirmRevoke({ share_id: s.id, name: s.shared_with_name })}
                          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all active:scale-95"
                          style={{ background: '#FEF2F2', color: '#DC2626' }}
                          aria-label={`בטל שיתוף עם ${s.shared_with_name}`}
                          title="בטל שיתוף">
                          <UserMinus className="w-4 h-4" />
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
    </>
  );
}
