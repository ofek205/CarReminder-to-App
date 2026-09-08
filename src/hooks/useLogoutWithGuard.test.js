/**
 * The copy in this dialog is the safety mechanism, so it is tested like one.
 *
 * There is no React testing setup in this repo (vitest runs in node), so the
 * hook's wiring is verified in the preview and the COPY is pinned here. That
 * split is deliberate rather than lazy: the wording is what determines whether
 * a user understands they are about to destroy work, and it is pure data.
 */
import { describe, it, expect } from 'vitest';
import { logoutWarningCopy } from './useLogoutWithGuard';

describe('logoutWarningCopy', () => {
  it('uses the Hebrew singular for one change', () => {
    // "1 שינויים" is wrong Hebrew and reads as broken software, which is the
    // last impression to give at the moment someone is deciding whether to
    // trust a warning about losing data.
    const { description } = logoutWarningCopy(1);
    expect(description).toContain('שינוי אחד');
    expect(description).not.toMatch(/^1 שינויים/);
    expect(description).toContain('הוא יימחק');   // singular agreement
  });

  it('uses the plural, with the count, for more than one', () => {
    const { description } = logoutWarningCopy(4);
    expect(description).toContain('4 שינויים');
    expect(description).toContain('הם יימחקו');   // plural agreement
  });

  it('states plainly that the data is lost and unrecoverable', () => {
    // The description must be impossible to read as "we will save it later".
    for (const n of [1, 3]) {
      const { description } = logoutWarningCopy(n);
      expect(description).toMatch(/יימחק/);
      expect(description).toMatch(/לא יהיה אפשר לשחזר/);
      // And it must not soften the loss with a promise of syncing.
      expect(description).not.toMatch(/יסונכרן|ימתין|נסה שוב/);
    }
  });

  it('warns honestly when the queue could not be read', () => {
    // Failing toward a warning is the point: a false "nothing pending" would
    // wave the user through and destroy work.
    const { title, description } = logoutWarningCopy('unknown');
    expect(title).toContain('ייתכן');
    expect(description).toMatch(/לא הצלחנו לבדוק/);
    expect(description).toMatch(/לא יהיה אפשר לשחזר/);
  });

  it('never uses a dash as a Hebrew separator', () => {
    // House rule: comma, colon, period or newline only.
    for (const n of [1, 2, 'unknown']) {
      const { title, description } = logoutWarningCopy(n);
      expect(`${title} ${description}`).not.toMatch(/[—–]|\s-\s/);
    }
  });
});
