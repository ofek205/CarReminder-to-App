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
 *   if (canEdit(role)) { ... }
 */

// Design tokens used by ROLE_INFO below. Earlier this import was
// accidentally pasted INSIDE the JSDoc block above — the parser
// treated it as a comment and ROLE_INFO threw `C is not defined`
// in production. Keep this on its own line outside any comment.
import { C } from '@/lib/designTokens';

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
 *  unchanged so existing rows + RLS predicates still match. Only the
 *  user-facing `label` changes.
 *
 *  Canonical account-role vocabulary (spec §5): בעלים / מנהל / צופה —
 *  three visually-distinct words, each distinct in its FIRST word (critical
 *  in RTL). The earlier labels 'שותף עורך' / 'שותף צופה' collided on the
 *  word "שותף" (both the viewer role key AND a shared prefix of both):
 *    'מנהל' → 'מנהל'   (edit/add + invite members; no delete, no ownership)
 *    'שותף' → 'צופה'   (read-only)
 *  Note: per-vehicle SHARING keeps its own vocabulary (עורך / צופה) — that
 *  is a separate surface from account membership.
 */
export const ROLE_INFO = {
  'בעלים': { label: 'בעלים', description: 'שליטה מלאה: ניהול, עריכה ומחיקה',  color: C.warn, bg: C.warnBg, icon: 'Crown' },
  'מנהל':  { label: 'מנהל',  description: 'מוסיף ועורך הכל, חוץ ממחיקת רכבים', color: '#2563EB', bg: C.infoBg, icon: 'Shield' },
  'שותף':  { label: 'צופה',  description: 'צפייה בלבד, ללא עריכה או מחיקה',    color: C.gray500, bg: C.gray100, icon: 'User' },
};
