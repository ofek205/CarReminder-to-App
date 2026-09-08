#!/usr/bin/env node
/**
 * Writes the commit-gatekeeper approval token.
 *
 * Run ONLY after the commit-gatekeeper skill has completed all 10 stages and
 * printed an APPROVED verdict. Never preemptively, never on BLOCKED.
 *
 * The token is consumed by the first `git commit`/`git push` that follows and
 * expires after 10 minutes, so every commit needs its own fresh review.
 *
 * Replaces the old `date +%s > /tmp/cardocs-gatekeeper-approved`, which wrote
 * to a POSIX path that does not exist on Windows — one of several reasons the
 * gate never actually ran here.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const TOKEN_PATH = path.join(os.tmpdir(), 'carreminder-gatekeeper-approved');

fs.writeFileSync(TOKEN_PATH, String(Date.now()), 'utf8');
process.stdout.write(`gatekeeper: approval token written, valid 10 minutes, single use\n${TOKEN_PATH}\n`);
