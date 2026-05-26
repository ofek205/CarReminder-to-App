/**
 * Permission helpers for family vehicle sharing.
 *
 * Roles:
 *   בעלים (Owner) . full control
 *   מנהל  (Admin) . add/edit, but not delete vehicles or remove members
 *   חבר   (Member). view only
 *
 * Usage:
 *   import { canEdit, canDelete, canManage, isViewOnly } from '@/lib/permissions';
import { C } from '@/lib/designTokens';
 *   if (canEdit(role)) { ... }
 */

/** Owner or Admin. can add/edit vehicles, maintenance, documents */
export function canEdit(role) {
  return role === 'בעלים' || role === 'מנהל';
}

/** Owner only. can delete vehicles, remove members */
export function canDelete(role) {
  return role === 'בעלים';
}

/** Owner or Admin. can invite members, manage account settings */
export function canManage(role) {
  return role === 'בעלים' || role === 'מנהל';
}

/** Owner or Admin. can send invites */
export function canInvite(role) {
  return canManage(role);
}

/** Is Owner */
export function isOwner(role) {
  return role === 'בעלים';
}

/** View-only role. no mutations */
export function isViewOnly(role) {
  return role === 'שותף';
}

/** Role display info.
 *  DB keys are the Hebrew strings 'בעלים' / 'מנהל' / 'שותף' — kept
 *  unchanged so existing rows + RLS predicates still match. The
 *  `label` field is the user-facing copy and was renamed per
 *  product feedback to make permission-level explicit at a glance:
 *    'מנהל' → 'שותף עורך'   (can edit, can't delete the vehicle)
 *    'שותף' → 'שותף צופה'   (read-only)
 *  These align with the per-vehicle share dialog ("עורך" / "צופה")
 *  so users see the same vocabulary across the account-level and
 *  vehicle-level sharing surfaces.
 */
export const ROLE_INFO = {
  'בעלים': { label: 'בעלים',     description: 'שליטה מלאה: ניהול, עריכה ומחיקה',  color: C.warn, bg: C.warnBg, icon: 'Crown' },
  'מנהל':  { label: 'שותף עורך', description: 'מוסיף ועורך הכל, חוץ ממחיקת רכבים', color: '#2563EB', bg: C.infoBg, icon: 'Shield' },
  'שותף':  { label: 'שותף צופה', description: 'צפייה בלבד, ללא עריכה או מחיקה',    color: C.gray500, bg: C.gray100, icon: 'User' },
};
