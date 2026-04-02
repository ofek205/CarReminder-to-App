/**
 * Permission helpers for family vehicle sharing.
 *
 * Roles:
 *   בעלים (Owner)  — full control
 *   מנהל  (Admin)  — add/edit, but not delete vehicles or remove members
 *   חבר   (Member) — view only
 *
 * Usage:
 *   import { canEdit, canDelete, canManage, isViewOnly } from '@/lib/permissions';
 *   if (canEdit(role)) { ... }
 */

/** Owner or Admin — can add/edit vehicles, maintenance, documents */
export function canEdit(role) {
  return role === 'בעלים' || role === 'מנהל';
}

/** Owner only — can delete vehicles, remove members */
export function canDelete(role) {
  return role === 'בעלים';
}

/** Owner or Admin — can invite members, manage account settings */
export function canManage(role) {
  return role === 'בעלים' || role === 'מנהל';
}

/** Owner or Admin — can send invites */
export function canInvite(role) {
  return canManage(role);
}

/** Is Owner */
export function isOwner(role) {
  return role === 'בעלים';
}

/** View-only role — no mutations */
export function isViewOnly(role) {
  return role === 'שותף';
}

/** Role display info */
export const ROLE_INFO = {
  'בעלים': { label: 'בעלים', description: 'שליטה מלאה — ניהול, עריכה ומחיקה', color: '#D97706', bg: '#FEF3C7', icon: 'Crown' },
  'מנהל':  { label: 'מנהל',  description: 'הוספה ועריכה — ללא מחיקת רכבים',   color: '#2563EB', bg: '#DBEAFE', icon: 'Shield' },
  'שותף':  { label: 'שותף',  description: 'צפייה בלבד — ללא עריכה או מחיקה',  color: '#6B7280', bg: '#F3F4F6', icon: 'User' },
};
