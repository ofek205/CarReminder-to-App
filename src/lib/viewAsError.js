/**
 * One place that turns a view-as failure code into something an operator can
 * act on.
 *
 * Why a shared module rather than a map per caller: enterViewAs is reached from
 * two places — the admin drawer (entering) and the workspace switcher (moving
 * between the target's workspaces mid-session) — and each had grown its own
 * partial mapping. A code neither of them knew about reached the screen raw, so
 * a Hebrew UI showed "impersonation_unavailable" and, worse, "נסה שוב" for
 * conditions that will never succeed no matter how many times you retry.
 *
 * That is the same shape as every other regression in this feature: a rule
 * re-remembered at each call site. One map means a new server code costs one
 * edit here, not one edit per caller.
 *
 * Mirrors the ROLE_ERROR / errText pattern already used in
 * src/pages/TeamManagement.jsx.
 */

const VIEW_AS_ERROR = {
  // ── Refusals decided by admin_start_view, before a session is created ──
  cannot_view_admin:
    'לא ניתן לצפות בחשבון של מנהל מערכת. הצפייה נועדה ללקוחות בלבד.',
  account_has_no_owner:
    'לחשבון הזה אין בעלים, ולכן אין דרך לדעת בתור מי להיכנס. שייך אותו למשתמש קודם.',
  not_a_member:
    'המשתמש הזה אינו חבר פעיל במרחב העבודה הזה.',
  account_not_found:
    'החשבון לא נמצא.',
  unauthorized:
    'אין לך הרשאה לצפות בחשבונות.',

  // ── Failures after the session exists ──
  // Deliberately does NOT say "try again": entering rolls the session back, so
  // the correct next step is to re-enter from user management, not to retry a
  // flow that already cleaned itself up.
  impersonation_unavailable:
    'לא ניתן לאמת את הזהות לצפייה. הצפייה בוטלה ולא נפתחה.',
  no_active_view_session:
    'הצפייה הסתיימה. היכנס שוב מניהול המשתמשים.',
  session_expired:
    'זמן הצפייה הסתיים. היכנס שוב מניהול המשתמשים.',
  cannot_impersonate_admin:
    'לא ניתן לצפות בחשבון של מנהל מערכת. הצפייה נועדה ללקוחות בלבד.',
  impersonation_not_configured:
    'שירות הצפייה אינו מוגדר בשרת. פנה למפתח — חסר IMPERSONATION_JWT_SECRET.',

  // Deploy-order mistake, not a bug. PostgREST answers PGRST202 when the bundle
  // calls admin_start_view with p_user_id but the database still has the old
  // two-argument signature. Naming the file to run turns a dead-end error into
  // an instruction.
  PGRST202:
    'פונקציית הצפייה בשרת לא עודכנה. הרץ את supabase-view-as-target-user-2026-07-24.sql ב-Supabase ואז נסה שוב.',
};

/**
 * Hebrew text for a thrown view-as error, or `fallback` when nothing matches.
 *
 * Checks `err.code` first — PostgREST reports its own failures there (PGRST202
 * for a signature mismatch) with a message that never contains the code.
 *
 * Then matches anywhere in the message rather than anchoring at the start: a
 * plpgsql `raise exception 'not_a_member'` reaches the client wrapped in
 * surrounding text, so a leading-token match missed every server-side refusal.
 */
export function viewAsErrorText(err, fallback = 'שגיאה בכניסה לחשבון. נסה שוב.') {
  if (err?.code && VIEW_AS_ERROR[err.code]) return VIEW_AS_ERROR[err.code];
  const msg = err?.message || String(err || '');
  for (const code of Object.keys(VIEW_AS_ERROR)) {
    if (msg.includes(code)) return VIEW_AS_ERROR[code];
  }
  return fallback;
}

export { VIEW_AS_ERROR };
