/**
 * Reading a raised name out of a Supabase error, and the Hebrew for the two
 * that any write can now meet.
 *
 * ── why the scrape exists ────────────────────────────────────────────────
 * A PL/pgSQL `raise exception 'transfer_expired'` reaches the client as a
 * message with the name somewhere inside it, not as a clean code. Every dialog
 * in this project that maps errors to Hebrew does the same regex to get it
 * back out. It was written twice before the ownership-transfer work and four
 * times after, so it lives here now.
 *
 * ── why the freeze copy exists, and why it is not optional ───────────────
 * Two triggers can refuse an ordinary write on an ordinary screen:
 *
 *   vehicle_history_frozen  an ownership offer is open on this vehicle
 *   vehicle_archived        it has already been handed to its new owner
 *
 * Neither is reachable from any button; both arrive at a save the user
 * expected to work. Before this module, MaintenanceSection answered both with
 * "לא הצלחנו לשמור. נסה שוב" — which is worse than showing the raw code,
 * because it invites the user to retry an action that cannot ever succeed, and
 * says nothing about the state that is actually blocking them or how to leave
 * it.
 *
 * So any catch block on a vehicle-scoped write should ask freezeMessageFor()
 * first and fall back to its own generic copy only when the answer is null.
 */

/** The raised name inside a Supabase/PostgREST error, or '' if there is none. */
export function rpcErrorCode(error) {
  return (error?.message || '').match(/[a-z_]+/)?.[0] || '';
}

const FREEZE_COPY = {
  // Reversible, and the way out is on the same screen: the banner on the
  // vehicle page carries a "ביטול ההצעה" button. Say so, because a user who
  // does not know the offer exists cannot guess it.
  vehicle_history_frozen:
    'יש הצעת העברה פתוחה לרכב הזה, אז ההיסטוריה שלו נעולה עד שהיא תיענה או תבוטל. ' +
    'אפשר לבטל אותה מהבאנר בראש דף הרכב.',
  // Not reversible from the app, and the copy must not pretend otherwise.
  vehicle_archived:
    'הרכב הזה הועבר לבעלים אחרים ונשמר אצלך לקריאה בלבד.',
};

/**
 * Hebrew for a freeze refusal, or null when the error is something else.
 * Callers keep their own generic message for the null case.
 */
export function freezeMessageFor(error) {
  return FREEZE_COPY[rpcErrorCode(error)] || null;
}
