/**
 * "החשבון הפרטי שלי" must only be said to the person who owns it.
 *
 * THE BUG THIS PINS: every non-business workspace was labelled with that
 * string. A user granted מנהל / שותף / driver on ANOTHER person's personal
 * workspace saw it in their switcher as their own — two identical rows, one
 * of them asserting ownership of an account belonging to somebody else.
 * Found on a live account on 2026-09-26; three users are in that state.
 *
 * The two fall-through cases below are the ones worth having a test for. A
 * label that is merely wrong is a cosmetic bug; a label that flips for all
 * 617 single-workspace users because a field was missing is a real one, and
 * both missing fields are REACHABLE: `viewerId` is null while auth resolves
 * on every cold start, and `owner_user_id` can be absent on a row rehydrated
 * from an older offline cache.
 */
import { describe, it, expect } from 'vitest';
import {
  workspaceLabel,
  PERSONAL_LABEL,
  PERSONAL_LABEL_VIEW_AS,
  PERSONAL_LABEL_SHARED,
  BUSINESS_LABEL_FALLBACK,
} from './workspaceLabel';

const ME = 'user-me';
const THEM = 'user-them';

const personal = (over = {}) => ({
  account_type: 'personal',
  account_name: null,
  owner_user_id: ME,
  ...over,
});

describe('workspaceLabel', () => {
  describe('business workspaces are unchanged', () => {
    it('uses the account name', () => {
      expect(workspaceLabel({ account_type: 'business', account_name: 'אופק רכבים בעמ' }, false, ME))
        .toBe('אופק רכבים בעמ');
    });
    it('falls back when the business has no name', () => {
      expect(workspaceLabel({ account_type: 'business', account_name: null }, false, ME))
        .toBe(BUSINESS_LABEL_FALLBACK);
    });
  });

  describe('my own personal workspace', () => {
    it('is still "שלי"', () => {
      expect(workspaceLabel(personal(), false, ME)).toBe(PERSONAL_LABEL);
    });
    it('is still "שלי" even when the account happens to carry a name', () => {
      // The 617-user path. A name on my OWN account must not displace "שלי".
      expect(workspaceLabel(personal({ account_name: 'החשבון של אופק' }), false, ME))
        .toBe(PERSONAL_LABEL);
    });
  });

  describe("someone else's personal workspace", () => {
    it('shows their name instead of claiming it is mine', () => {
      expect(workspaceLabel(personal({ owner_user_id: THEM, account_name: 'inbar miller' }), false, ME))
        .toBe('inbar miller');
    });
    it('says it is shared when the account has no name', () => {
      expect(workspaceLabel(personal({ owner_user_id: THEM, account_name: null }), false, ME))
        .toBe(PERSONAL_LABEL_SHARED);
    });
    it('treats an empty-string name as no name', () => {
      expect(workspaceLabel(personal({ owner_user_id: THEM, account_name: '' }), false, ME))
        .toBe(PERSONAL_LABEL_SHARED);
    });
  });

  describe('view-as wins over ownership', () => {
    it('never says "שלי" to an impersonating admin', () => {
      // During view-as the memberships are the TARGET's while viewerId is the
      // ADMIN's, so an ownership comparison is meaningless — and the row is
      // synthesized without owner_user_id at all.
      expect(workspaceLabel({ account_type: 'personal', account_name: 'inbar miller' }, true, ME))
        .toBe(PERSONAL_LABEL_VIEW_AS);
      expect(workspaceLabel(personal(), true, ME)).toBe(PERSONAL_LABEL_VIEW_AS);
    });
  });

  describe('missing data falls back to the owner wording, not away from it', () => {
    it('keeps "שלי" while auth is still resolving (viewerId null)', () => {
      // Every cold start passes through this state. Relabelling here would
      // flash someone their own account under a stranger's name.
      expect(workspaceLabel(personal({ owner_user_id: THEM, account_name: 'inbar miller' }), false, null))
        .toBe(PERSONAL_LABEL);
    });
    it('keeps "שלי" when the row has no owner_user_id', () => {
      // Reachable from an offline cache written by an older bundle.
      expect(workspaceLabel(personal({ owner_user_id: undefined, account_name: 'inbar miller' }), false, ME))
        .toBe(PERSONAL_LABEL);
    });
    it('does not throw on a null membership', () => {
      expect(workspaceLabel(null, false, ME)).toBe('');
    });
  });
});
