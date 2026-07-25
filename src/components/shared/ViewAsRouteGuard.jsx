import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import useViewAs from '@/hooks/useViewAs';
import { C } from '@/lib/designTokens';

/**
 * ViewAsRouteGuard — keeps admin pages closed while an admin is viewing a
 * customer's account.
 *
 * Layout already hides the admin nav during view-as, with the reasoning
 * spelled out there: admin tools act on explicit ids, and reaching for one
 * while the client is pointed at somebody else's account is how the wrong
 * record gets edited. But hiding a link is not a guard. Typing /AdminHome —
 * or landing on it from history, a bookmark, or the back button — rendered
 * the whole admin dashboard mid-session: every user, every open bug, the
 * broadcast composer.
 *
 * Each admin page gates on useIsAdmin(), which stays true during view-as
 * because the admin's JWT never changes. Adding `&& !isViewAs` to all 13 of
 * them would work until the 14th is written. Worse, useIsAdmin() cannot
 * simply return false mid-session: WorkspaceContext calls it before
 * admin_current_view to restore the session after a refresh, so that would
 * make view-as unable to survive a reload — the guard would break the thing
 * it guards.
 *
 * So the check lives at the single place every route already passes through,
 * and matches by route name. New admin pages inherit it by naming
 * convention rather than by remembering.
 */

// Admin surfaces whose route name doesn't start with "Admin".
const EXTRA_ADMIN_ROUTES = new Set(['EmailCenter']);

export function isAdminRoute(routeName) {
  if (!routeName) return false;
  return routeName.startsWith('Admin') || EXTRA_ADMIN_ROUTES.has(routeName);
}

export default function ViewAsRouteGuard({ routeName, children }) {
  const viewAs = useViewAs();

  if (!viewAs || !isAdminRoute(routeName)) return children;

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-5" dir="rtl">
      <div className="max-w-sm w-full rounded-3xl p-8 text-center space-y-5"
        style={{ background: C.card, boxShadow: '0 8px 40px rgba(0,0,0,0.08)' }}>
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto"
          style={{ background: C.warnSubtle }}>
          <ShieldAlert className="h-10 w-10" style={{ color: C.warnDark }} />
        </div>
        <h2 className="font-bold text-xl" style={{ color: C.primaryDark }}>
          אזור הניהול סגור בזמן צפייה
        </h2>
        <p className="text-sm leading-relaxed" style={{ color: C.textAlt }}>
          אתה צופה כרגע בחשבון של <strong>{viewAs.targetName || 'משתמש'}</strong>.
          כלי הניהול פועלים על מזהים מפורשים, ולכן הם נעולים עד שתצא מהצפייה —
          כדי שלא תפעל בטעות על החשבון הלא נכון.
        </p>
        <p className="text-xs" style={{ color: C.mutedAlt }}>
          צא מהצפייה מהסרגל הכתום למעלה, ואז חזור לכאן.
        </p>
        <Link to="/Dashboard"
          className="inline-block w-full h-12 leading-[3rem] rounded-2xl font-bold text-sm"
          style={{ background: C.bgSubtle, color: C.textAlt }}>
          חזרה לחשבון הנצפה
        </Link>
      </div>
    </div>
  );
}
