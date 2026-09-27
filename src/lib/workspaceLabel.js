/**
 * The name a workspace is shown under in the switcher.
 *
 * Extracted from WorkspaceSwitcher.jsx so the decision can be tested: the
 * suite runs in node with no jsdom, and importing the component would pull in
 * react-router, lucide and sonner just to assert a string.
 */

export const PERSONAL_LABEL = 'החשבון הפרטי שלי';

// "שלי" is a lie during an admin view-as session — the personal workspace
// listed there belongs to the account being viewed, not to the admin reading
// the screen. Naming it "mine" is the single most misleading string in the
// impersonation flow: it makes the admin's own account look present in a
// list that never contained it.
export const PERSONAL_LABEL_VIEW_AS = 'חשבון פרטי';

// Someone else's personal workspace, for the case where the account carries
// no name to show. Deliberately NOT the bare 'חשבון פרטי' above: in the 140px
// pill that reads too close to a truncated "החשבון הפרטי…", and this is the
// one row with no name to tell it apart, so it needs the stronger wording.
export const PERSONAL_LABEL_SHARED = 'חשבון פרטי משותף';

export const BUSINESS_LABEL_FALLBACK = 'חשבון עסקי';

/**
 * @param {object} m         a membership row from v_user_workspaces
 * @param {boolean} isViewAs admin impersonation session
 * @param {string|null} viewerId  the signed-in user's id, null while auth resolves
 */
export function workspaceLabel(m, isViewAs = false, viewerId = null) {
  if (!m) return '';

  if (m.account_type === 'business') {
    return m.account_name || BUSINESS_LABEL_FALLBACK;
  }

  // Checked before ownership on purpose: during view-as the memberships are
  // the TARGET's while `viewerId` is the ADMIN's, so an ownership comparison
  // there would be meaningless. It is also synthesized without owner_user_id.
  if (isViewAs) return PERSONAL_LABEL_VIEW_AS;

  // "שלי" is only true for the OWNER. A user can be granted מנהל / שותף /
  // driver on another person's PERSONAL workspace, and until now that
  // workspace was labelled "החשבון הפרטי שלי" as well — so the switcher
  // showed two identical rows, one of them claiming ownership of an account
  // belonging to somebody else. Found on a real account 2026-09-26; three
  // users are in this state today.
  //
  // Decided on owner_user_id and NOT on role, deliberately. `role` is listed
  // in STRIPPED_FIELDS in query-persister.js — it is an authorization verdict
  // and must never sit on disk — so offline it is undefined and a role check
  // would silently relabel every workspace. owner_user_id is not stripped.
  //
  // Both unknowns fall through to the owner wording: viewerId null (auth
  // still resolving) and owner_user_id absent (an older cached row). That is
  // what 617 of 620 users are looking at, so it is the safer flash.
  const someoneElses = !!viewerId && !!m.owner_user_id && m.owner_user_id !== viewerId;
  if (!someoneElses) return PERSONAL_LABEL;

  // The NAME, with no "חשבון פרטי של" prefix in front of it. Both render
  // sites apply CSS `truncate`, and at 140px a shared prefix eats the width
  // and cuts off the one part that differs — every row would read
  // "חשבון פרטי של…" and we would have rebuilt the bug we are fixing. The
  // adjacent UserIcon already carries "personal", and a bare Latin name is a
  // single directional run, so this also avoids a bidi mix inside an RTL
  // string.
  return m.account_name || PERSONAL_LABEL_SHARED;
}
