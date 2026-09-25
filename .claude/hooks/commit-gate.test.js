/**
 * Tests for the commit gate's matcher, its session-scoped token path, and the
 * real hook as a process.
 *
 * This gate is the entire trust boundary for every commit Claude makes in this
 * repo, and until 2026-09-08 it had no tests at all. It has already failed OPEN
 * once, silently, for months (see the docblock in commit-gate.cjs), and it was
 * found on 2026-09-08 to not match `git merge` even though a merge creates a
 * commit. Both failures are of the same kind: nobody could see what the regex
 * actually covered. So the coverage is written down here as a table.
 *
 * The third block exists because the first two do not exercise the token at
 * all. A predicate test cannot tell you whether the gate reads the right file,
 * consumes it, or refuses another session's — which is where the second bug of
 * 2026-09-08 lived. Those cases spawn the hook the way Claude Code spawns it:
 * a real process, a real JSON payload on stdin, a real exit code.
 *
 * The file lives beside the hook rather than under src/ because vitest's default
 * include does scan dot-directories, so `npm test` collects it, which means
 * pre-push and the PR gate enforce it too.
 *
 * One caveat on the pre-push half, verified 2026-09-08: its test step is
 * guarded by `[ -x node_modules/.bin/vitest ]`, so in a checkout with no
 * node_modules — an agent worktree, most often — pre-push skips the suite
 * silently rather than failing. The "Unit tests" job in production-gates.yml
 * runs `npm test` after `npm ci` and has no such escape, so a PR to main
 * cannot dodge it. If you are working in a worktree, run the suite yourself.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// The hook is CommonJS (.cjs) and must stay that way: Claude's hook runner
// invokes it directly with node. Loading it does not run it, thanks to the
// require.main guard.
const require = createRequire(import.meta.url);
const { isGated, resolveSessionId, tokenPath } = require('./commit-gate.cjs');

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

// ───────────────────────────── session scoping ─────────────────────────────
//
// The token used to live at one machine-wide path, so with several Claude
// sessions open on this repo — five were live while this was written — one
// session's review authorized another's commit, and one session could eat
// another's token. Everything below exists to keep that from coming back.

describe('session id resolution', () => {
  it('accepts CURSOR_CONVERSATION_ID when Claude Code did not export one', () => {
    expect(resolveSessionId({ CURSOR_CONVERSATION_ID: 'bc-c7aef12-1111-4111-8111-aaaaaaaaaaaa' })).toBe(
      'bc-c7aef12-1111-4111-8111-aaaaaaaaaaaa'
    );
  });

  it('prefers CLAUDE_CODE_SESSION_ID when both are present', () => {
    expect(resolveSessionId({
      CLAUDE_CODE_SESSION_ID: '4d1595ef-8305-4860-ae1d-f98c2c67828c',
      CURSOR_CONVERSATION_ID: 'bc-c7aef12-1111-4111-8111-aaaaaaaaaaaa',
    })).toBe('4d1595ef-8305-4860-ae1d-f98c2c67828c');
  });

  it('accepts the id Claude Code actually exports', () => {
    // Measured from a real PreToolUse invocation, not invented.
    expect(resolveSessionId({ CLAUDE_CODE_SESSION_ID: '4d1595ef-8305-4860-ae1d-f98c2c67828c' })).toBe(
      '4d1595ef-8305-4860-ae1d-f98c2c67828c'
    );
  });

  it('trims surrounding whitespace', () => {
    expect(resolveSessionId({ CLAUDE_CODE_SESSION_ID: '  abcdefgh  ' })).toBe('abcdefgh');
  });

  const REJECTED = [
    [{}, 'the variable is absent'],
    [{ CLAUDE_CODE_SESSION_ID: '' }, 'it is empty'],
    [{ CLAUDE_CODE_SESSION_ID: '   ' }, 'it is only whitespace'],
    [{ CLAUDE_CODE_SESSION_ID: 'short' }, 'it is too short to be an id'],
    [{ CLAUDE_CODE_SESSION_ID: 'a'.repeat(201) }, 'it is absurdly long'],
    [{ CLAUDE_CODE_SESSION_ID: '../../etc/passwd' }, 'it walks out of the temp dir'],
    [{ CLAUDE_CODE_SESSION_ID: 'a/b/cdefgh' }, 'it contains a path separator'],
    [{ CLAUDE_CODE_SESSION_ID: 'a\\b\\cdefgh' }, 'it contains a windows separator'],
    [{ CLAUDE_CODE_SESSION_ID: 'C:\\Windows\\Temp\\x' }, 'it is an absolute path'],
    [{ CLAUDE_CODE_SESSION_ID: 'abcdefgh; rm -rf /' }, 'it carries shell punctuation'],
    [{ CLAUDE_CODE_SESSION_ID: 'abcdefg\u0000h' }, 'it carries a NUL byte'],
  ];

  // Every one of these must be null, which is a BLOCK at the call site. The
  // charset check is doing security work, not tidiness: this value becomes
  // part of a file path.
  it.each(REJECTED)('returns null when %j (%s)', (env) => {
    expect(resolveSessionId(env)).toBeNull();
  });

  it('rejects a non-string, which is what a cleared env var can look like', () => {
    for (const value of [undefined, null, 42, {}]) {
      expect(resolveSessionId({ CLAUDE_CODE_SESSION_ID: value })).toBeNull();
    }
  });
});

describe('token path derivation', () => {
  const A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

  it('is stable for one session', () => {
    expect(tokenPath(A)).toBe(tokenPath(A));
  });

  it('differs between two sessions, which is the whole point', () => {
    expect(tokenPath(A)).not.toBe(tokenPath(B));
  });

  it('lands in the temp dir, one file per session', () => {
    expect(path.dirname(tokenPath(A))).toBe(require('node:os').tmpdir());
    expect(path.basename(tokenPath(A))).toMatch(/^carreminder-gatekeeper-approved-[0-9a-f]{32}$/);
  });

  it('does not leak the raw session id into the filename', () => {
    // os.tmpdir() is /tmp on Linux and world-readable, so the id is hashed
    // rather than interpolated.
    expect(tokenPath(A)).not.toContain(A);
  });

  it('refuses an unvalidated id rather than building a path out of it', () => {
    // A caller that skips resolveSessionId gets an exception, which main()
    // turns into a BLOCK — not a token at a path of the attacker's choosing.
    for (const bad of [undefined, null, '', 'short', '../../evil', 'a/b/cdefgh']) {
      expect(() => tokenPath(bad)).toThrow(/validated session id/);
    }
  });

  it('never collides with the old shared path', () => {
    // If it did, the pre-scoping token would still be spendable.
    expect(path.basename(tokenPath(A))).not.toBe('carreminder-gatekeeper-approved');
  });
});

// ──────────────────────── the hook as a real process ────────────────────────
//
// Spawned, not imported. These are the only tests that touch the token file,
// the exit codes, and the order of the checks inside main() — everything the
// predicate tests are blind to.

describe('the gate as a spawned process', () => {
  const GATE = fileURLToPath(new URL('./commit-gate.cjs', import.meta.url));
  const APPROVE = fileURLToPath(new URL('./approve.cjs', import.meta.url));

  // Ids unique to this test run, so a real session's token can never be read,
  // consumed or overwritten by the suite. Derived from the pid rather than
  // randomly, so a failure is reproducible from the output.
  let n = 0;
  const nextId = (tag) => `test-${tag}-${process.pid}-${++n}`;

  const written = new Set();
  const put = (id, stamp) => {
    const p = tokenPath(id);
    fs.writeFileSync(p, String(stamp), 'utf8');
    written.add(p);
    return p;
  };

  afterEach(() => {
    for (const p of written) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* consumed by the gate, which is usually the thing under test */
      }
    }
    written.clear();
  });

  /** The payload shape was captured from a real PreToolUse invocation. */
  const payload = (command) => ({
    session_id: 'irrelevant-on-purpose',
    transcript_path: 'C:\\Users\\x\\.claude\\projects\\p\\s.jsonl',
    cwd: 'C:\\repo',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command, description: 'test' },
    tool_use_id: 'toolu_test',
  });

  /** `sessionId: null` means the variable is absent, not empty. */
  const run = (command, sessionId, input) => {
    const env = { ...process.env };
    // Ambient Cursor id must not satisfy "no session" cases.
    delete env.CURSOR_CONVERSATION_ID;
    if (sessionId === null) delete env.CLAUDE_CODE_SESSION_ID;
    else env.CLAUDE_CODE_SESSION_ID = sessionId;

    let body = input;
    if (input === undefined) {
      const p = payload(command);
      // Default fixtures carry a dummy session_id. A "no session" case must
      // not be rescued by that field, or the fail-closed test stops meaning
      // "no identity at all".
      if (sessionId === null) {
        delete p.session_id;
        delete p.conversation_id;
      }
      body = JSON.stringify(p);
    }

    return spawnSync(process.execPath, [GATE], {
      input: body,
      env,
      encoding: 'utf8',
    });
  };

  it('blocks a gated command when this session has no token', () => {
    const r = run('git commit -m x', nextId('notoken'));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('BLOCKED by commit-gatekeeper');
    expect(r.stderr).toContain('No approval token found for this session');
  });

  it('allows a gated command when THIS session has a fresh token', () => {
    const id = nextId('fresh');
    put(id, Date.now());
    expect(run('git commit -m x', id).status).toBe(0);
  });

  it('does not let one session spend another session\'s token', () => {
    // The regression this scoping exists for. Before it, both of these passed
    // through: the token was one file for the whole machine.
    const mine = nextId('victim');
    const theirs = nextId('thief');
    const theirToken = put(theirs, Date.now());

    const r = run('git commit -m x', mine);
    expect(r.status).toBe(2);
    // And it did not consume the other session's token on the way out, which
    // is the second half of the old bug: the theft used to block the session
    // that had actually done the review.
    expect(fs.existsSync(theirToken)).toBe(true);
  });

  it('consumes the token, so a second attempt is blocked', () => {
    const id = nextId('singleuse');
    const p = put(id, Date.now());
    expect(run('git commit -m x', id).status).toBe(0);
    expect(fs.existsSync(p)).toBe(false);
    expect(run('git commit -m x', id).status).toBe(2);
  });

  it('blocks an expired token and clears it', () => {
    const id = nextId('expired');
    const p = put(id, Date.now() - 11 * 60 * 1000);
    const r = run('git commit -m x', id);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/expired \d+ minutes ago/);
    expect(fs.existsSync(p)).toBe(false);
  });

  it('blocks a token timestamped in the future', () => {
    const id = nextId('future');
    put(id, Date.now() + 60 * 60 * 1000);
    expect(run('git commit -m x', id).stderr).toContain('timestamped in the future');
  });

  it('blocks an unreadable token', () => {
    const id = nextId('garbage');
    put(id, 'not-a-timestamp');
    expect(run('git commit -m x', id).stderr).toContain('unreadable');
  });

  it('allows an ungated command without needing a token', () => {
    expect(run('git status --short', nextId('ungated')).status).toBe(0);
  });

  it('blocks a gated command when the session cannot be identified', () => {
    // The fail-closed half of the undocumented-env-var risk. If Claude Code
    // stops exporting CLAUDE_CODE_SESSION_ID, gated commands stop, loudly.
    const r = run('git commit -m x', null);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('could not identify this Claude session');
  });

  it('still allows ungated commands when the session cannot be identified', () => {
    // The order of the checks in main() is load-bearing. Resolving the session
    // before the isGated check would block EVERY Bash call in a session with no
    // session id, which is a broken tool, not a safe gate.
    expect(run('git status --short', null).status).toBe(0);
    expect(run('npm run build', null).status).toBe(0);
  });

  it('blocks a gated command when the session id is path-shaped', () => {
    const r = run('git commit -m x', '../../evil');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('could not identify this Claude session');
  });

  it('never falls back to the pre-scoping shared token', () => {
    // Someone could still have the old file lying around from before this
    // change, or from an older checkout running in parallel. It must be inert.
    const legacy = path.join(require('node:os').tmpdir(), 'carreminder-gatekeeper-approved');
    const preexisting = fs.existsSync(legacy);
    if (!preexisting) fs.writeFileSync(legacy, String(Date.now()), 'utf8');
    try {
      expect(run('git commit -m x', nextId('legacy')).status).toBe(2);
    } finally {
      if (!preexisting) fs.unlinkSync(legacy);
    }
  });

  it('fails closed on a malformed payload', () => {
    const id = nextId('malformed');
    put(id, Date.now());
    expect(run('git commit -m x', id, 'not json at all').status).toBe(2);
    expect(run('git commit -m x', id, '').status).toBe(2);
  });

  it('allows a payload that carries no command at all', () => {
    const r = spawnSync(process.execPath, [GATE], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'x' } }),
      env: process.env,
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
  });

  it('ignores payload.session_id, because approve.cjs cannot see it', () => {
    // Deliberate, and documented in commit-gate.cjs: the two halves must agree
    // on the key, and only the environment reaches both. A token for the ENV
    // session is spendable even though the payload names a different session.
    const envId = nextId('envwins');
    put(envId, Date.now());
    const r = spawnSync(process.execPath, [GATE], {
      input: JSON.stringify({ ...payload('git commit -m x'), session_id: 'some-other-session-id' }),
      env: { ...process.env, CLAUDE_CODE_SESSION_ID: envId },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
  });

  // ── approve.cjs, the other half ──

  const approve = (sessionId) => {
    const env = { ...process.env };
    delete env.CURSOR_CONVERSATION_ID;
    if (sessionId === null) delete env.CLAUDE_CODE_SESSION_ID;
    else env.CLAUDE_CODE_SESSION_ID = sessionId;
    return spawnSync(process.execPath, [APPROVE], { env, encoding: 'utf8' });
  };

  it('approve.cjs writes a token the gate then accepts, end to end', () => {
    // The round trip. Neither half is verified by testing it alone: this is
    // the only test that would catch the two derivations drifting apart.
    const id = nextId('roundtrip');
    const p = tokenPath(id);
    written.add(p);

    const a = approve(id);
    expect(a.status).toBe(0);
    expect(a.stdout).toContain(id);
    expect(fs.existsSync(p)).toBe(true);

    expect(run('git commit -m x', id).status).toBe(0);
    expect(fs.existsSync(p)).toBe(false);
  });

  it('accepts a token scoped to CURSOR_CONVERSATION_ID when Claude did not export one', () => {
    const id = nextId('cursor-conv');
    const p = tokenPath(id);
    written.add(p);
    const env = { ...process.env };
    delete env.CLAUDE_CODE_SESSION_ID;
    env.CURSOR_CONVERSATION_ID = id;

    const a = spawnSync(process.execPath, [APPROVE], { env, encoding: 'utf8' });
    expect(a.status).toBe(0);
    expect(fs.existsSync(p)).toBe(true);

    const r = spawnSync(process.execPath, [GATE], {
      input: JSON.stringify(payload('git commit -m x')),
      env,
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(fs.existsSync(p)).toBe(false);
  });

  it('approve.cjs writes a token no OTHER session can spend', () => {
    const mine = nextId('scoped');
    const other = nextId('outsider');
    written.add(tokenPath(mine));

    expect(approve(mine).status).toBe(0);
    expect(run('git commit -m x', other).status).toBe(2);
    // Still there: the outsider could not consume it either.
    expect(fs.existsSync(tokenPath(mine))).toBe(true);
  });

  it('approve.cjs refuses to write anything when the session is unknown', () => {
    // It must not fall back to a shared path. A token you cannot scope is a
    // token any concurrent session could spend.
    const legacy = path.join(require('node:os').tmpdir(), 'carreminder-gatekeeper-approved');
    const preexisting = fs.existsSync(legacy);

    const r = approve(null);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('NO TOKEN WRITTEN');
    if (!preexisting) expect(fs.existsSync(legacy)).toBe(false);
  });

  it('approve.cjs refuses a path-shaped session id', () => {
    const r = approve('../../evil');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('NO TOKEN WRITTEN');
  });
});

// ─────────────────────────────── the wiring ───────────────────────────────
//
// The gate can be perfect and still not run, and it cannot fail closed on its
// own absence: a PreToolUse hook that exits 1 — which is what node does on
// MODULE_NOT_FOUND — is a NON-BLOCKING error, and the tool call proceeds. So
// the check that the configured gate actually exists has to live out here,
// where a test run will notice.
//
// This was measured, in the least comfortable way. The agent worktree this
// change was written in sat 109 commits behind staging, on a base that
// predated the Node gate: `.claude/hooks/` did not exist there and
// settings.json still wired the legacy inline-shell gate. A command the
// matcher gates ran completely unblocked, twice, and the identical command was
// blocked the moment the Node gate was wired in its place. Nothing anywhere
// said the gate was missing — from inside, an ungated session looks exactly
// like a gated one until you deliberately probe it.
//
// Staging is wired correctly today, so these five cases are a ratchet rather
// than a fix: they fail in any checkout where the suite runs and the gate is
// mis-wired, stale, or gone.
describe('the gate is actually wired', () => {
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  const settings = JSON.parse(fs.readFileSync(path.join(repoRoot, '.claude/settings.json'), 'utf8'));
  const entries = (settings.hooks?.PreToolUse ?? []).filter((e) => /Bash/.test(e.matcher || ''));

  it('has exactly one PreToolUse entry covering shell tools', () => {
    expect(entries).toHaveLength(1);
  });

  it('covers PowerShell as well as Bash', () => {
    // The project denies `PowerShell(git push:*)` but not `git commit`, so a
    // Bash-only matcher left the whole PowerShell tool ungated.
    expect(entries[0].matcher).toMatch(/\bBash\b/);
    expect(entries[0].matcher).toMatch(/\bPowerShell\b/);
  });

  it('runs THIS gate and nothing else', () => {
    const commands = entries[0].hooks.map((h) => h.command);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain('commit-gate.cjs');
    // The legacy token path must not survive anywhere in the wiring.
    expect(commands[0]).not.toContain('cardocs-gatekeeper-approved');
  });

  it('points at a file that exists', () => {
    // $CLAUDE_PROJECT_DIR is what Claude Code exports as the session root, and
    // it is used instead of a bare relative path so the gate still resolves
    // when the session's cwd is a subdirectory. Verified live: it expands even
    // though this repo's path contains a space and parentheses. A relative
    // path is resolved against the repo root here so this stays true either
    // way — the assertion is about the file, not about the spelling.
    const command = entries[0].hooks[0].command;
    const referenced = command
      .replace(/^node\s+/, '')
      .replace(/^"|"$/g, '')
      .replace('$CLAUDE_PROJECT_DIR', repoRoot.replace(/[/\\]$/, ''));
    expect(fs.existsSync(path.resolve(repoRoot, referenced))).toBe(true);
  });

  it('the hooks it references are tracked by git, not just present locally', () => {
    // A file present in one checkout and nowhere else is how a fresh clone or
    // a worktree ends up pointing at nothing.
    const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '.claude/hooks/commit-gate.cjs', '.claude/hooks/approve.cjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(tracked.status).toBe(0);
  });
});
