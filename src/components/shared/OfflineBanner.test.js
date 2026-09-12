/**
 * All five banner states, as a table.
 *
 * This component renders only on signed-in pages, so its states cannot be
 * reached in a preview without a real session — and covering every state
 * (default / loading / empty / error / offline) is a hard requirement in this
 * project, not a nicety. Pinning the pure selector covers them properly, and
 * catches the wording regressions a visual pass would miss.
 */
import { describe, it, expect } from 'vitest';
import { bannerState } from './OfflineBanner';

describe('bannerState', () => {
  it('renders NOTHING for an online user with an empty queue', () => {
    // The no-regression property: someone who is never offline sees the same
    // DOM as before any of this existed.
    expect(bannerState({ isOnline: true })).toBe(null);
    expect(bannerState({ isOnline: true, pending: 0, failed: 0, lingering: false })).toBe(null);
  });

  it('keeps the original copy when offline with nothing queued', () => {
    const s = bannerState({ isOnline: false });
    expect(s.message).toBe('אין חיבור לאינטרנט. מוצגים הנתונים האחרונים שנשמרו.');
    expect(s.tone).toBe('neutral');
  });

  it('reassures that offline changes are held, not lost', () => {
    expect(bannerState({ isOnline: false, pending: 1 }).message)
      .toBe('אין חיבור לאינטרנט. שינוי אחד ממתין לסנכרון.');
    expect(bannerState({ isOnline: false, pending: 3 }).message)
      .toBe('אין חיבור לאינטרנט. 3 שינויים ממתינים לסנכרון.');
  });

  it('says nothing about a sync that has not had time to linger', () => {
    // A drain normally finishes well under a second. Without this, every
    // reconnect would flash a strip and shove the page down and back.
    expect(bannerState({ isOnline: true, pending: 2, lingering: false })).toBe(null);
  });

  it('reports a lingering sync, and reassures the data is on disk', () => {
    const s = bannerState({ isOnline: true, pending: 2, lingering: true });
    expect(s.message).toBe('הסנכרון מתעכב. 2 שינויים שמורים במכשיר.');
    expect(s.tone).toBe('neutral');   // a delay is not an error
  });

  it('gives failures the danger tone and makes them tappable', () => {
    // The only state needing a DECISION is the only one that changes colour and
    // offers an action.
    const s = bannerState({ isOnline: true, failed: 2 });
    expect(s.message).toBe('2 שינויים לא נשמרו בשרת.');
    expect(s.tone).toBe('danger');
    expect(s.tappable).toBe(true);
  });

  it('shows failures even while offline, because they outrank connectivity', () => {
    const s = bannerState({ isOnline: false, pending: 5, failed: 1 });
    expect(s.message).toBe('שינוי אחד לא נשמר בשרת.');
    expect(s.tone).toBe('danger');
  });

  it('never uses a dash as a Hebrew separator', () => {
    const cases = [
      { isOnline: false }, { isOnline: false, pending: 1 }, { isOnline: false, pending: 3 },
      { isOnline: true, pending: 2, lingering: true }, { isOnline: true, failed: 1 },
    ];
    for (const c of cases) {
      expect(bannerState(c).message).not.toMatch(/[—–]|\s-\s/);
    }
  });
});
