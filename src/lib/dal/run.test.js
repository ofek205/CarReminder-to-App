/**
 * Pins the offline write guard's contract.
 *
 * The load-bearing decision here is that the guard HONOURS each command's
 * declared shape: a `returnsEnvelope` command resolves `{ data: null, error }`
 * and everything else throws. That is what let the guard land across ~200 call
 * sites without editing any of them — 32 of the 121 commands are read by call
 * sites that branch on `error` rather than using try/catch, so throwing at
 * those sites would skip the error branch they already have and surface as an
 * unhandled rejection wherever no outer catch exists.
 *
 * Nothing about that is visible in a build or a lint run. Flip one
 * `returnsEnvelope` flag, or "simplify" the guard to always throw, and the
 * failure appears in production as a silent no-op or an unhandled rejection.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { onlineManager } from '@tanstack/react-query';
import { runCommand } from './run';
import { defineCommand } from './registry';
import {
  isOfflineError,
  OfflineError,
  OFFLINE_QUEUEABLE_MESSAGE,
  OFFLINE_REQUIRED_MESSAGE,
} from './errors';

// Registered once at module load; names are unique to this file so they cannot
// collide with the real registry.
let calls = [];
defineCommand('test.envelopeCapable', {
  offlineCapable: true,
  returnsEnvelope: true,
  run: (p) => { calls.push(p); return Promise.resolve({ data: 'ok', error: null }); },
});
defineCommand('test.envelopeOnlineOnly', {
  offlineCapable: false,
  returnsEnvelope: true,
  run: (p) => { calls.push(p); return Promise.resolve({ data: 'ok', error: null }); },
});
defineCommand('test.throwingCapable', {
  offlineCapable: true,
  run: (p) => { calls.push(p); return Promise.resolve('ok'); },
});
defineCommand('test.throwingOnlineOnly', {
  offlineCapable: false,
  run: (p) => { calls.push(p); return Promise.resolve('ok'); },
});

beforeEach(() => { calls = []; onlineManager.setOnline(true); });
afterEach(() => { onlineManager.setOnline(true); });

describe('runCommand while ONLINE', () => {
  it('passes the payload straight through and returns the command result', () => {
    // Positive control for everything below: if the guard were always on, the
    // offline assertions would pass for the wrong reason.
    return runCommand('test.throwingCapable', { a: 1 }).then((res) => {
      expect(res).toBe('ok');
      expect(calls).toEqual([{ a: 1 }]);
    });
  });

  it('does not touch an envelope command result', async () => {
    const res = await runCommand('test.envelopeCapable', { a: 2 });
    expect(res).toEqual({ data: 'ok', error: null });
  });
});

describe('runCommand while OFFLINE', () => {
  beforeEach(() => { onlineManager.setOnline(false); });

  it('RESOLVES an envelope command instead of throwing', async () => {
    // The whole point. A call site doing `const { error } = await dal.run(...)`
    // must keep working, and must reach its own error branch.
    const res = await runCommand('test.envelopeCapable', { a: 1 });
    expect(res.data).toBe(null);
    expect(isOfflineError(res.error)).toBe(true);
    expect(res.error).toBeInstanceOf(OfflineError);
  });

  it('THROWS for a command that throws', async () => {
    await expect(runCommand('test.throwingCapable', { a: 1 })).rejects.toBeInstanceOf(OfflineError);
  });

  it('never reaches the network — run() is not called', async () => {
    // A fast-fail, not a failure after a round trip. This is what turned an 8s
    // spinner into an immediate, readable refusal.
    await runCommand('test.envelopeCapable', { a: 1 });
    await runCommand('test.throwingCapable', { a: 1 }).catch(() => {});
    expect(calls).toEqual([]);
  });

  it('marks offline-capable work queueable, and invites a retry', async () => {
    // `queueable` is the flag Phase 3 branches on to enqueue rather than refuse.
    const res = await runCommand('test.envelopeCapable', {});
    expect(res.error.queueable).toBe(true);
    expect(res.error.message).toBe(OFFLINE_QUEUEABLE_MESSAGE);
  });

  it('marks online-required work non-queueable, and refuses flatly', async () => {
    // Sharing, membership, admin: these can never be replayed later, so the
    // wording must not promise that retrying will help.
    const res = await runCommand('test.envelopeOnlineOnly', {});
    expect(res.error.queueable).toBe(false);
    expect(res.error.message).toBe(OFFLINE_REQUIRED_MESSAGE);
  });

  it('carries a message that is safe to show the user as-is', async () => {
    // Several catch blocks interpolate err.message straight into a toast
    // (ReminderSettingsPage, RepairsSection, Expenses, MyVehicles), so a
    // technical string here would surface verbatim in Hebrew UI.
    for (const name of ['test.envelopeCapable', 'test.envelopeOnlineOnly']) {
      const { error } = await runCommand(name, {});
      expect(error.message).toMatch(/[֐-׿]/);          // is Hebrew
      expect(error.message).not.toMatch(/[a-z]{4,}|Error|null|undefined/);
    }
  });

  it('still fails loudly for an unknown command', async () => {
    // A typo must never be swallowed as "offline" — that would silently
    // discard a user's write.
    await expect(runCommand('nope.nope', {})).rejects.toThrow(/unknown command/);
  });
});

describe('isOfflineError', () => {
  it('recognises an OfflineError however it arrives', () => {
    expect(isOfflineError(new OfflineError('x'))).toBe(true);
    // Duck-typed on purpose, so it survives crossing a chunk boundary.
    expect(isOfflineError({ isOffline: true })).toBe(true);
  });

  it('tolerates junk without throwing', () => {
    // It is called from catch blocks and from toastError, where the argument
    // may be anything at all.
    for (const junk of [undefined, null, {}, 0, '', new Error('plain')]) {
      expect(isOfflineError(junk)).toBe(false);
    }
  });
});
