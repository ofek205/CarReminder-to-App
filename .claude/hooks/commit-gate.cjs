#!/usr/bin/env node
/**
 * PreToolUse gate — blocks `git commit` / `git push` issued by Claude Code
 * unless the commit-gatekeeper skill has just produced an APPROVED verdict.
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
 * token, a thrown exception — exits 2 (BLOCK). A gate that cannot evaluate
 * itself must never be the reason a commit succeeds. If this misfires you
 * will find out immediately, which is the entire point.
 *
 * Exit codes: 0 = allow, 2 = block (stderr is shown to Claude).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const TOKEN_PATH = path.join(os.tmpdir(), 'carreminder-gatekeeper-approved');
const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes, single use

/** Matches `git commit` / `git push` including `git -C <dir> push`, `git --no-pager commit`, etc. */
const GIT_WRITE = /(^|[;&|`]\s*|\$\(\s*)git(\s+(-[^\s]+|--[^\s]+)(\s+[^\s]+)?)*\s+(commit|push)(\s|$)/;

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

  // Not a git write — allow, and say nothing.
  if (!GIT_WRITE.test(command)) process.exit(0);

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
      ? 'No approval token found.'
      : !Number.isFinite(issuedAt)
        ? 'The approval token was unreadable.'
        : age < 0
          ? 'The approval token is timestamped in the future.'
          : `The approval token expired ${Math.round(age / 60000)} minutes ago.`;

  block(
    `${why}\n\n` +
      'Before retrying this git commit/push you MUST:\n' +
      '  1. Invoke the commit-gatekeeper skill (Skill tool)\n' +
      '  2. Run the full 10-stage review on the staged diff\n' +
      '  3. Output the mandatory final-format verdict\n' +
      '  4. Only if APPROVED, write the token:\n' +
      '       node .claude/hooks/approve.cjs\n' +
      '  5. Retry the git command (token is single-use, valid 10 min)\n\n' +
      'חסום על ידי שומר הסף — הרץ את סקיל commit-gatekeeper, הפק חוות דעת\n' +
      'APPROVED, וכתוב את האסימון לפני הקומיט/פוש.'
  );
}

try {
  main();
} catch (err) {
  block(`The gate threw an unexpected error and is failing closed:\n${err && err.stack}`);
}
