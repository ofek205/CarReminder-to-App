#!/usr/bin/env node
/**
 * PreToolUse gate — blocks the git commands that create or rewrite commits
 * (commit, push, merge, pull, rebase, cherry-pick, revert, am) when issued by
 * Claude Code, unless the commit-gatekeeper skill has just produced an
 * APPROVED verdict.
 *
 * WHY THIS IS NODE AND NOT SHELL
 * ------------------------------
 * The previous version was a one-line POSIX `sh` script embedded in
 * settings.json. It used cat/sed/grep/date/tr and a `/tmp/...` token path.
 * On Windows none of those are on the PATH of Claude's Bash tool, so:
 *
 *   grep missing -> exit 127 -> `if ! <127>` is TRUE -> `exit 0` = ALLOW
 *
 * The gate failed OPEN. Its own failure authorized the commit, silently, for
 * months. Node is the one interpreter this project can rely on everywhere
 * (every workflow runs `npm ci`), so the gate is written in Node and the
 * shell is taken out of the trust path entirely.
 *
 * FAIL-CLOSED CONTRACT
 * --------------------
 * Any unexpected condition — unreadable stdin, malformed payload, unreadable
 * token, an unidentifiable session, a thrown exception — exits 2 (BLOCK). A
 * gate that cannot evaluate itself must never be the reason a commit
 * succeeds. If this misfires you will find out immediately, which is the
 * entire point.
 *
 * Exit codes: 0 = allow, 2 = block (stderr is shown to Claude).
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes, single use

/**
 * WHY THE TOKEN IS SCOPED TO A SESSION
 * ------------------------------------
 * Until 2026-09-08 the token lived at ONE machine-wide path:
 *
 *   path.join(os.tmpdir(), 'carreminder-gatekeeper-approved')
 *
 * Ofek routinely runs several Claude sessions against this repo at once — five
 * were live in it while this was being written (three in the main checkout,
 * two in worktrees, each with its own session id). With one shared path the
 * invariant CLAUDE.md advertises, "every commit Claude makes was reviewed by
 * the gatekeeper for THAT diff", degraded into "every commit consumed a token
 * that SOME session on this machine issued in the last 10 minutes". Session
 * A's review authorized session B's commit. Single-use consumption and the TTL
 * narrowed the window; they did not close it.
 *
 * It also went the other way: a session could silently eat another session's
 * token, blocking a commit that had in fact just been reviewed and forcing a
 * pointless second review. Both symptoms were observed, twice, while probing
 * the gate — the probe consumed a parallel session's fresh token.
 *
 * So the path now carries the session identity, and a token issued in one
 * session is invisible to every other.
 *
 * WHY process.env AND NOT payload.session_id
 * ------------------------------------------
 * The PreToolUse payload does carry `session_id` — that is the documented
 * field, and it was measured here rather than assumed:
 *
 *   {"session_id":"4d1595ef-…","transcript_path":"…","cwd":"…",
 *    "hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{…}}
 *
 * It is still the wrong choice, because the gate is only half of this. The
 * other half is approve.cjs, which Claude runs as an ordinary Bash command and
 * which therefore never sees that payload. Both halves must derive the SAME
 * key or the token can never be spent, and the only channel both can read is
 * the process environment, where Claude Code exports:
 *
 *   CLAUDE_CODE_SESSION_ID=4d1595ef-8305-4860-ae1d-f98c2c67828c
 *
 * verified identical in the hook's env, in the Bash tool's env, and in the
 * payload's `session_id`, for this session.
 *
 * Comparing the two as a consistency check was considered and rejected. The
 * env var belongs to the Claude Code PROCESS, so it is the same for a session
 * and for any subagent it spawns, while a subagent's payload may well carry
 * its own id. Blocking on a mismatch would buy no extra safety — both values
 * name this same session either way — and would brick a legitimate flow the
 * first time a subagent ran the gatekeeper. The env var alone already gives
 * the whole guarantee: equal within a session, different across concurrent
 * ones.
 *
 * The cost of that choice, stated plainly: CLAUDE_CODE_SESSION_ID is NOT in
 * the documented list of variables Claude Code exports to hooks (that list is
 * CLAUDE_PROJECT_DIR, CLAUDE_PLUGIN_ROOT, CLAUDE_PLUGIN_DATA, CLAUDE_EFFORT).
 * It is real and it is present, but it is undocumented, so a future version
 * could drop it. That failure is safe and loud in both directions: the gate
 * blocks every gated command, and approve.cjs refuses to write a token at all.
 * Nobody gets a silent allow, and the fix is one line here.
 *
 * Cursor cloud agents do not put CLAUDE_CODE_SESSION_ID in the hook process.
 * The shell that runs approve.cjs does have CURSOR_CONVERSATION_ID, and the
 * hook payload session_id is that same conversation id. approve.cjs therefore
 * reads the env var, and this hook reads the payload only when neither env
 * var is set. A Claude session id still wins, including when it is present
 * but invalid, so a bad Claude id cannot silently switch keys.
 *
 * WHAT THIS STILL DOES NOT FIX
 * ----------------------------
 * The token authorizes a SESSION for ten minutes, not a specific diff. Inside
 * one session you can review D1, take the token, stage more work, and commit
 * D2. Binding the token to a hash of the staged diff would close that too, and
 * was deliberately left out: it would put `git diff --cached` — a subprocess,
 * a cwd assumption and a worktree assumption — inside the one code path that
 * must never fail for an avoidable reason, and it would not cover push, merge
 * or rebase, which have no staged diff at all. If it is ever added, it belongs
 * ALONGSIDE the session key, not instead of it.
 */
const SESSION_ID_RE = /^[A-Za-z0-9._-]{8,200}$/;

/**
 * The current session's id, or null if it cannot be established.
 *
 * Null is a BLOCK at every call site — never a fall back to a shared path,
 * which is the bug this function exists to remove.
 *
 * The charset check is not decoration. The id is about to become part of a
 * file path, and an id containing `..` or a drive letter would aim the token
 * somewhere else entirely. Anything that is not plainly an identifier is
 * treated as no id at all.
 *
 * `env` is injectable so the tests can exercise the missing and malformed
 * cases without mutating the real process environment.
 */
function sessionIdFrom(raw) {
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  if (!SESSION_ID_RE.test(id)) return null;
  return id;
}

function resolveSessionId(env, payloadSessionId) {
  const source = env || process.env;
  // A string that fails the charset check must stay a block. Falling through
  // to another id would let a rejected Claude id pick a different key.
  if (typeof source.CLAUDE_CODE_SESSION_ID === 'string') {
    return sessionIdFrom(source.CLAUDE_CODE_SESSION_ID);
  }
  if (typeof source.CURSOR_CONVERSATION_ID === 'string') {
    return sessionIdFrom(source.CURSOR_CONVERSATION_ID);
  }
  return sessionIdFrom(payloadSessionId);
}

/**
 * Where this session's approval token lives.
 *
 * The id is hashed rather than interpolated, for two reasons. It makes the
 * traversal question moot a second time, after the charset check — no input
 * can reach the path as path syntax. And on Linux os.tmpdir() is /tmp, which
 * is world-readable, so a filename containing the raw session id would publish
 * it to every other user on the box. The digest is truncated to 128 bits,
 * which is far past what distinguishing a handful of concurrent sessions
 * needs.
 *
 * Throws on an invalid id, so a caller that forgets to check resolveSessionId
 * gets an exception — which main() turns into a BLOCK — rather than a path
 * built out of `undefined`.
 *
 * One session leaves at most one ~13-byte file behind, and nothing prunes
 * siblings on purpose. Sweeping "expired" ones would mean deleting other
 * sessions' files on the strength of a timestamp, and a clock skew would then
 * rob a live session of a token it had just earned — reintroducing the theft
 * this change removed, in a tidier costume. The OS reaps its own temp dir.
 */
function tokenPath(sessionId) {
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
    throw new Error('tokenPath requires a validated session id');
  }
  const digest = crypto.createHash('sha256').update(sessionId, 'utf8').digest('hex').slice(0, 32);
  return path.join(os.tmpdir(), `carreminder-gatekeeper-approved-${digest}`);
}

/**
 * Matches commit, push, merge, pull, rebase, cherry-pick, revert and am,
 * including forms like `git -C <dir> push` and `git --no-pager commit`.
 *
 * Everything past commit and push is here because it CREATES OR REWRITES a
 * commit, and none of it was matched before, so such a commit could enter
 * history with no gatekeeper review at all while CLAUDE.md described the gate
 * as covering every commit Claude makes. Found 2026-09-08, when a sync merge
 * sailed straight through it. `pull` matters as much as `merge`: it is fetch
 * plus merge, so leaving it out would have left the same hole one word wide.
 *
 * `merge-base` and `merge-tree` are read-only and must keep working. The
 * trailing (\s|$) is what excludes them, since both continue with a hyphen.
 * `git cherry` survives the same way but for the opposite reason: it is a
 * real read-only command, and the alternation demands the whole `cherry-pick`
 * token, so plain `cherry` never matches.
 *
 * `am` is the shortest token here, so it looks like the most collision-prone,
 * and it is not. The option-consuming group above only skips DASH-PREFIXED
 * tokens, which makes the verb the first non-option word after `git`. So
 * `git checkout -- am` and `git branch am` never reach the alternation at
 * all, and only a real `git am` matches. Measured, not assumed: I asserted
 * the opposite here first and the test caught me.
 *
 * That is every PORCELAIN command that creates or rewrites a commit. Resist
 * reading it as total coverage, which is the overclaim this file has already
 * been burned by. Still unmatched, and out of scope by design:
 *   - `commit-tree`, plumbing that writes a commit OBJECT which no branch
 *     points at until `update-ref` moves something.
 *   - `update-ref`, which moves a branch to an existing commit.
 *   - `reset`, which moves a branch and can discard uncommitted work. It
 *     creates nothing, so this gate is NOT protection against it.
 * None of these puts an unreviewed commit into history through the normal
 * path. If that ever stops being true, add them and fix this comment.
 */
const GIT_WRITE = /(^|[;&|`]\s*|\$\(\s*)git(\s+(-[^\s]+|--[^\s]+)(\s+[^\s]+)?)*\s+(commit|push|merge|pull|rebase|cherry-pick|revert|am)(\s|$)/;

/**
 * `--abort` and `--quit` unwind a half-finished operation and cannot create a
 * commit, on any of the five that can be interrupted: merge, rebase,
 * cherry-pick, revert and am. Needing a fresh gatekeeper token merely to
 * escape one of those would be a trap, so they are exempt. `pull` is absent
 * deliberately: it has no abort of its own, you unwind the merge or rebase
 * underneath it.
 *
 * `--continue` and `--skip` are deliberately NOT exempt. Both go on to create
 * commits, which is the whole thing being gated.
 *
 * Anchored to the WHOLE command deliberately. Matching loosely would exempt
 * `git merge --abort && git commit -m x` and hand back the very bypass this
 * change closes.
 *
 * The cost, learned by tripping over it within a minute of shipping this: a
 * COMPOUND command carrying an unwind is still blocked, so `cd /repo && git
 * merge --abort` needs a token while a bare `git merge --abort` does not. Run
 * the unwind on its own; the Bash tool's working directory persists, so the
 * `cd` is not needed anyway. Teaching this exemption to parse shell segments
 * would put quote handling in the path of a decision that must fail closed,
 * which is a bad trade for saving one keystroke.
 */
const UNWIND_ONLY = /^\s*git\s+(merge|rebase|cherry-pick|revert|am)\s+--(abort|quit)\s*$/;

/** The whole decision, exported so it can be tested instead of trusted. */
function isGated(command) {
  if (typeof command !== 'string') return false;
  if (UNWIND_ONLY.test(command)) return false;
  return GIT_WRITE.test(command);
}

function block(message) {
  process.stderr.write(`\n=== BLOCKED by commit-gatekeeper ===\n\n${message}\n`);
  process.exit(2);
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return null; // treated as a malfunction below, not as "no command"
  }
}

function main() {
  const raw = readStdin();
  if (raw === null) {
    block(
      'The gate could not read the hook payload from stdin.\n' +
        'This is a malfunction, not a policy decision — it fails closed by design.\n' +
        'Inspect .claude/hooks/commit-gate.cjs before retrying.'
    );
  }

  // An empty payload is a malformed invocation, not an empty command.
  if (!raw.trim()) {
    block('The gate received an empty hook payload. Failing closed.');
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    block('The gate could not parse the hook payload as JSON. Failing closed.');
  }

  const command = payload?.tool_input?.command;

  // Not a string means this tool call carries no command for us to judge
  // (e.g. a tool whose input is shaped differently). Nothing to gate.
  if (typeof command !== 'string') process.exit(0);

  // Not a gated git command — allow, and say nothing.
  if (!isGated(command)) process.exit(0);

  // Only now, once we know a token is actually required. Resolving the session
  // any earlier would mean a missing env var blocked every Bash call in the
  // session instead of only the gated ones — fail-closed is the contract for
  // the commands this gate guards, not a licence to break the whole tool.
  const sessionId = resolveSessionId(undefined, payload?.session_id);
  if (sessionId === null) {
    block(
      'The gate could not identify this Claude session.\n\n' +
        'CLAUDE_CODE_SESSION_ID is missing or not a plain identifier, so there is\n' +
        'no way to tell this session\'s approval token from another session\'s. The\n' +
        'gate will not fall back to a shared token — that sharing is the exact bug\n' +
        'this scoping removed.\n\n' +
        'This is a malfunction, not a policy decision. Check whether Claude Code\n' +
        'still exports CLAUDE_CODE_SESSION_ID (`env | grep CLAUDE_CODE_SESSION_ID`)\n' +
        'and update resolveSessionId in .claude/hooks/commit-gate.cjs to match.'
    );
  }

  const TOKEN_PATH = tokenPath(sessionId);

  let stamp;
  try {
    if (!fs.existsSync(TOKEN_PATH)) stamp = null;
    else stamp = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
  } catch {
    block('An approval token exists but could not be read. Failing closed.');
  }

  // The token is single-use: consume it before deciding, so a stale or
  // rejected token can never be reused by a retry.
  if (stamp !== null) {
    try {
      fs.unlinkSync(TOKEN_PATH);
    } catch {
      /* already gone — fall through to the age check */
    }
  }

  const issuedAt = Number(stamp);
  const age = Date.now() - issuedAt;

  if (stamp !== null && Number.isFinite(issuedAt) && age >= 0 && age < TOKEN_TTL_MS) {
    process.exit(0); // fresh, valid, now consumed
  }

  const why =
    stamp === null
      ? 'No approval token found for this session.'
      : !Number.isFinite(issuedAt)
        ? 'The approval token was unreadable.'
        : age < 0
          ? 'The approval token is timestamped in the future.'
          : `The approval token expired ${Math.round(age / 60000)} minutes ago.`;

  block(
    `${why}\n\n` +
      'Before retrying this gated git command you MUST:\n' +
      '  1. Invoke the commit-gatekeeper skill (Skill tool)\n' +
      '  2. Run the full 10-stage review on the staged diff\n' +
      '  3. Output the mandatory final-format verdict\n' +
      '  4. Only if APPROVED, write the token:\n' +
      '       node .claude/hooks/approve.cjs\n' +
      '  5. Retry the git command (token is single-use, valid 10 min)\n\n' +
      'The token belongs to THIS session only. Another session\'s review cannot\n' +
      'authorize this command, and running approve.cjs from another session will\n' +
      'not help.\n\n' +
      'חסום על ידי שומר הסף — הרץ את סקיל commit-gatekeeper, הפק חוות דעת\n' +
      'APPROVED, וכתוב את האסימון לפני הקומיט/פוש.'
  );
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    block(`The gate threw an unexpected error and is failing closed:\n${err && err.stack}`);
  }
}

// Exported for .claude/hooks/commit-gate.test.js. Requiring this file must not
// run the gate, which is what the require.main guard above is for.
//
// Know what that guard costs: if this file is ever REQUIRED instead of executed,
// the gate does nothing and allows silently. That only happens if the command in
// settings.json stops being `node .claude/hooks/commit-gate.cjs`, and anyone able
// to rewrite that could remove the hook outright, so it buys testability without
// widening the real threat. Splitting the matcher into a sibling module was the
// alternative and is worse: a missing sibling throws at require time, outside the
// try/catch, exiting 1 rather than 2, which the runner treats as ALLOW.
//
// resolveSessionId and tokenPath are exported for a second reason beyond tests:
// approve.cjs requires them from here rather than keeping its own copy. Two
// copies of a key derivation are two things to edit and one to forget, and if
// they ever disagree the token silently becomes unspendable. Requiring in that
// direction is also the safe direction — if this file is missing, approve.cjs
// throws and writes NO token, so the gate stays shut.
//
// Everything else stays private. The two regexes and the id charset are
// implementation detail, and a security boundary should expose as little as it
// can get away with.
module.exports = { isGated, resolveSessionId, tokenPath };
