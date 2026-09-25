/**
 * The restore control's words and when it says them. The component itself
 * is thin; what matters is that each answer is honest and that offline wins.
 */

import { describe, it, expect } from 'vitest';
import { RESTORE_COPY, restoreMessage } from './RestoreControl';

describe('restoreMessage', () => {
  it('says nothing while idle or working', () => {
    expect(restoreMessage('idle', true)).toBeNull();
    expect(restoreMessage('working', true)).toBeNull();
  });

  it('says so when nothing was found, quietly', () => {
    expect(restoreMessage('none', true)).toEqual({ text: RESTORE_COPY.none, tone: 'muted' });
  });

  it('marks an error as an error', () => {
    expect(restoreMessage('error', true)).toEqual({ text: RESTORE_COPY.error, tone: 'error' });
  });

  it('puts offline first, whatever the last answer was', () => {
    for (const s of ['idle', 'working', 'none', 'error']) {
      expect(restoreMessage(s, false), s).toEqual({ text: RESTORE_COPY.offline, tone: 'muted' });
    }
  });
});

describe('RESTORE_COPY', () => {
  it('never talks about a charge, which is the verification banner\'s job', () => {
    for (const s of Object.values(RESTORE_COPY)) {
      expect(s, s).not.toMatch(/חויב|חיוב|תשלום|נקלט/);
    }
  });

  it('does not name a store, so the same words serve both phones', () => {
    for (const s of Object.values(RESTORE_COPY)) {
      expect(s, s).not.toMatch(/google|apple|play|app store|אפל|גוגל/i);
    }
  });

  it('says "for this account", because a purchase for another account is filtered out', () => {
    expect(RESTORE_COPY.none).toContain('עבור החשבון הזה');
  });

  it('has no dash separators', () => {
    for (const s of Object.values(RESTORE_COPY)) expect(s, s).not.toMatch(/[—–-]/);
  });
});
