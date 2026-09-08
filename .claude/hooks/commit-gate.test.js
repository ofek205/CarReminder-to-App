/**
 * Tests for the commit gate's matcher.
 *
 * This gate is the entire trust boundary for every commit Claude makes in this
 * repo, and until 2026-09-08 it had no tests at all. It has already failed OPEN
 * once, silently, for months (see the docblock in commit-gate.cjs), and it was
 * found on 2026-09-08 to not match `git merge` even though a merge creates a
 * commit. Both failures are of the same kind: nobody could see what the regex
 * actually covered. So the coverage is written down here as a table.
 *
 * The file lives beside the hook rather than under src/ because vitest's default
 * include does scan dot-directories, so `npm test` collects it, which means
 * pre-push and the PR gate enforce it too.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// The hook is CommonJS (.cjs) and must stay that way: Claude's hook runner
// invokes it directly with node. Loading it does not run it, thanks to the
// require.main guard.
const require = createRequire(import.meta.url);
const { isGated } = require('./commit-gate.cjs');

describe('commit gate matcher', () => {
  const GATED = [
    // The two it always covered.
    ['git commit -m "msg"', 'a plain commit'],
    ['git commit -q -m msg -- src/file.js', 'a commit with a pathspec'],
    ['git push origin staging', 'a plain push'],
    ['git --no-pager commit', 'a commit behind a global flag'],
    ['git -C /some/repo push origin main', 'a push behind -C'],

    // The hole this table was written for: every one of these creates a commit.
    ['git merge origin/staging', 'a merge'],
    ['git merge --no-ff origin/staging', 'a forced merge commit'],
    ['git merge --no-commit --no-ff origin/staging', 'a staged merge, which still moves the branch'],
    ['git merge --continue', 'finishing a conflicted merge, which commits'],
    ['git -C /some/repo merge foo', 'a merge behind -C'],

    // Compound commands: the gate must see past the first segment.
    ['echo hi && git merge foo', 'a merge after &&'],
    ['git status; git merge foo', 'a merge after a semicolon'],
    [
      'git merge --abort && git commit -m x',
      'the exemption below must NOT let a chained commit through',
    ],
  ];

  const ALLOWED = [
    // Read-only lookalikes. These share the `merge` prefix and are used
    // constantly to inspect a merge before running one; gating them would make
    // the safe path more expensive than the unsafe one.
    ['git merge-base --is-ancestor a b', 'merge-base is read-only'],
    ['git merge-tree --write-tree staging origin/staging', 'merge-tree is a dry run'],

    // Unwinding a merge cannot create a commit, and needing a token to escape a
    // broken merge would be a trap.
    ['git merge --abort', 'aborting a merge'],
    ['git merge --quit', 'quitting a merge'],
    ['  git merge --abort  ', 'aborting, with surrounding whitespace'],

    // Ordinary read-only git and non-git work.
    ['git status --short', 'status'],
    ['git diff --stat main..staging', 'diff'],
    ['git fetch origin', 'fetch does not create a commit'],
    ['git log --oneline -5', 'log'],
    ['git stash list', 'stash list'],
    ['npm test', 'not git at all'],
  ];

  it.each(GATED)('gates %s (%s)', (command) => {
    expect(isGated(command)).toBe(true);
  });

  it.each(ALLOWED)('allows %s (%s)', (command) => {
    expect(isGated(command)).toBe(false);
  });

  it('treats a non-string command as nothing to judge', () => {
    // A tool call whose input is shaped differently carries no command. main()
    // already exits 0 before reaching the matcher; this keeps the predicate
    // honest if that order ever changes.
    for (const value of [undefined, null, 42, {}, []]) {
      expect(isGated(value)).toBe(false);
    }
  });

  // ── What the matcher does with text that only LOOKS like a command ──
  //
  // The gate runs on raw command text and cannot tell a command from a string
  // containing one, so writing documentation about git through the shell can
  // trip it. That is a false BLOCK, and it is kept rather than fixed: teaching
  // the regex about shell quoting would trade a cheap false block for a
  // possible false allow, and this gate's entire contract is to fail closed.
  // Use the Write tool for such files instead.
  //
  // These three were measured against the matcher, not reasoned about. The
  // deciding factor is what FOLLOWS the verb, which is easy to get backwards.
  it('gates a quoted mention when a separator precedes it and whitespace follows', () => {
    expect(isGated('echo "a | git commit b"')).toBe(true);
  });

  it('does not gate a backticked mention, because the closing backtick is not whitespace', () => {
    expect(isGated('echo "see `git commit` docs"')).toBe(false);
    expect(isGated('echo " * blocks `git commit` / `git push`" > notes.md')).toBe(false);
  });

  it('does not gate a mention with no shell separator before it', () => {
    expect(isGated('echo "run git commit later"')).toBe(false);
  });
});
