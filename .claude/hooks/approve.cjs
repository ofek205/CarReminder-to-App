#!/usr/bin/env node
/**
 * Writes the commit-gatekeeper approval token.
 *
 * Run ONLY after the commit-gatekeeper skill has completed all 10 stages and
 * printed an APPROVED verdict. Never preemptively, never on BLOCKED.
 *
 * The token is consumed by the first gated git command that follows and
 * expires after 10 minutes, so every commit needs its own fresh review.
 *
 * Replaces the old `date +%s > /tmp/cardocs-gatekeeper-approved`, which wrote
 * to a POSIX path that does not exist on Windows — one of several reasons the
 * gate never actually ran here.
 *
 * THE TOKEN IS SCOPED TO THIS SESSION
 * -----------------------------------
 * It used to be one machine-wide file, which meant a review done in one Claude
 * session could authorize a commit in another — with several sessions open on
 * this repo at once, which is normal here, that is most of the guarantee gone.
 * The full reasoning, and why the session id comes from the environment rather
 * than from the hook payload this script never receives, is in the docblock of
 * commit-gate.cjs.
 *
 * The path derivation is REQUIRED from commit-gate.cjs rather than copied. If
 * the two ever disagreed, this would cheerfully write a token the gate never
 * looks at, and every commit would be blocked with no hint why.
 *
 * Exit codes: 0 = token written, 1 = no token written (and stderr says why).
 */

'use strict';

const fs = require('fs');

// Relative to THIS FILE, not to the caller's cwd, which is what require does.
// If it is missing, this throws and no token is written: the safe direction.
const { resolveSessionId, tokenPath } = require('./commit-gate.cjs');

const sessionId = resolveSessionId();

if (sessionId === null) {
  process.stderr.write(
    'gatekeeper: NO TOKEN WRITTEN.\n\n' +
      'CLAUDE_CODE_SESSION_ID is missing or is not a plain identifier, so there is\n' +
      'no session to scope the token to. Writing one anyway would mean writing a\n' +
      'shared token that any concurrent session could spend — the exact bug the\n' +
      'scoping removed — so this refuses instead.\n\n' +
      'The gate blocks in the same situation, so nothing is silently allowed.\n' +
      'Check `env | grep CLAUDE_CODE_SESSION_ID` and see resolveSessionId in\n' +
      '.claude/hooks/commit-gate.cjs.\n'
  );
  process.exit(1);
}

const target = tokenPath(sessionId);
fs.writeFileSync(target, String(Date.now()), 'utf8');
process.stdout.write(
  'gatekeeper: approval token written, valid 10 minutes, single use, ' +
    `scoped to session ${sessionId}\n${target}\n`
);
