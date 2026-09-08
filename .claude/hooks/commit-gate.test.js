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
    ['git pull', 'a bare pull, which is fetch plus merge'],
    ['git pull origin staging', 'a pull with a remote'],
    ['git pull --rebase', 'a pull that rebases instead of merging'],
    ['git pull --ff-only', 'a pull that only fast-forwards, which still moves the branch'],
    ['git rebase main', 'a rebase'],
    ['git rebase -i HEAD~3', 'an interactive rebase'],
    ['git rebase --continue', 'continuing a rebase, which commits'],
    ['git rebase --skip', 'skipping a patch, which carries on committing'],
    ['git cherry-pick abc123', 'a cherry-pick'],
    ['git cherry-pick --continue', 'continuing a cherry-pick, which commits'],
    ['git cherry-pick --skip', 'skipping within a cherry-pick, which carries on'],
    ['git revert HEAD', 'a revert, which writes a new commit'],
    ['git revert --continue', 'continuing a revert'],
    ['git am patch.mbox', 'applying a mailbox of patches'],
    ['git am --continue', 'continuing an am'],
    ['git am --skip', 'skipping a patch and carrying on'],

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
    ['git cherry -v main', 'cherry is read-only and is NOT cherry-pick'],

    // Unwinding a merge cannot create a commit, and needing a token to escape a
    // broken merge would be a trap.
    ['git merge --abort', 'aborting a merge'],
    ['git merge --quit', 'quitting a merge'],
    ['  git merge --abort  ', 'aborting, with surrounding whitespace'],
    ['git rebase --abort', 'aborting a rebase'],
    ['git rebase --quit', 'quitting a rebase'],
    ['git cherry-pick --abort', 'aborting a cherry-pick'],
    ['git cherry-pick --quit', 'quitting a cherry-pick'],
    ['git revert --abort', 'aborting a revert'],
    ['git revert --quit', 'quitting a revert'],
    ['git am --abort', 'aborting an am'],
    ['git am --quit', 'quitting an am'],

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

  it('still gates a compound command that merely contains an unwind', () => {
    // The documented cost of anchoring the exemption to the whole command, found
    // by running exactly this and being blocked. Loosening it to allow a prefix
    // would also allow `git merge --abort && git commit -m x`, so the unwind is
    // run bare instead.
    expect(isGated('cd /repo && git merge --abort')).toBe(true);
    expect(isGated('git merge --abort; echo done')).toBe(true);
    expect(isGated('git merge --abort')).toBe(false);
    expect(isGated('cd /repo && git rebase --abort')).toBe(true);
    expect(isGated('git rebase --abort')).toBe(false);
    expect(isGated('cd /repo && git cherry-pick --abort')).toBe(true);
    expect(isGated('git cherry-pick --abort')).toBe(false);
  });

  it('does not reach a verb that is not the first non-option token', () => {
    // Why the short `am` token is safe. The option-consuming group skips only
    // dash-prefixed words, so a subcommand like `checkout` or `branch` ends
    // the match before the alternation is ever tried. I asserted the opposite
    // first, claiming `git checkout -- am` was an accepted false positive, and
    // this test disproved it.
    expect(isGated('git checkout -- am')).toBe(false);
    expect(isGated('git branch am')).toBe(false);
    expect(isGated('git log -- revert')).toBe(false);
    expect(isGated('git checkout -- amount.js')).toBe(false);
    // A real invocation, and the global-option form, both still match.
    expect(isGated('git am patch.mbox')).toBe(true);
    expect(isGated('git --no-pager am patch.mbox')).toBe(true);
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
