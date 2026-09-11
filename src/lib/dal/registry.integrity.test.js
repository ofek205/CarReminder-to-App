/**
 * The seam's structural invariants, checked by scanning the source rather than
 * by importing it — importing `dal/index.js` would pull in the Supabase client
 * and need real env vars, and a static scan catches the same class of mistake.
 *
 * This replaces an ad-hoc node script that was re-run by hand on every commit
 * during the Phase 0-2 work. A check that depends on someone remembering to run
 * it is not a check.
 *
 * `dal.run` takes a STRING name, so a typo cannot be caught by the build, by
 * lint, or by types. It surfaces at runtime as "[dal] unknown command", i.e. a
 * user's write throwing at the moment they click save.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
// Imported explicitly rather than reached for as a global: eslint runs this
// file under the browser-globals config the rest of src/ uses, where `process`
// is undefined — and no-undef is an error here on purpose.
import { cwd } from 'node:process';

const SRC = path.join(cwd(), 'src');
const COMMANDS_DIR = path.join(SRC, 'lib', 'dal', 'commands');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(js|jsx)$/.test(entry.name) && !/\.test\.js$/.test(entry.name)) out.push(p);
  }
  return out;
}

const registered = [];
for (const file of readdirSync(COMMANDS_DIR)) {
  if (!file.endsWith('.js')) continue;
  const src = readFileSync(path.join(COMMANDS_DIR, file), 'utf8');
  const re = /defineCommand\(\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(src))) registered.push({ name: m[1], file });
}
const registeredNames = new Set(registered.map((r) => r.name));

const callSites = [];
for (const file of walk(SRC)) {
  const rel = path.relative(cwd(), file).split(path.sep).join('/');
  if (rel.includes('src/lib/dal/commands/')) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // `runOrThrow(` counts too. It is the thin wrapper some screens put
    // around dal.run so that an envelope command's failure actually throws,
    // and it takes the SAME command-name string as its first argument. Left
    // out, ten PostCard call sites would silently leave this scan and a typo
    // in one of them would reach production unchallenged: exactly the hole
    // this test exists to close, reopened by a rename.
    const re = /(?:dal\.run|runOrThrow)\(\s*'([^']+)'/g;
    let m;
    while ((m = re.exec(line))) {
      // Skip the doc placeholder in registry.js's header comment.
      if (m[1].includes('<')) continue;
      callSites.push({ name: m[1], where: `${rel}:${i + 1}` });
    }
  });
}

describe('DAL registry integrity', () => {
  it('registers a non-trivial number of commands, so a broken scan cannot pass silently', () => {
    // Guards the test itself: if the regex or the directory layout changed,
    // every assertion below would vacuously pass against an empty set.
    expect(registered.length).toBeGreaterThan(100);
    expect(callSites.length).toBeGreaterThan(100);
  });

  it('every dal.run() call site names a registered command', () => {
    const unknown = callSites.filter((c) => !registeredNames.has(c.name));
    expect(unknown.map((u) => `${u.name} @ ${u.where}`)).toEqual([]);
  });

  it('registers each command name exactly once', () => {
    // Two files defining the same name means one silently wins, and which one
    // depends on import order in dal/index.js.
    const seen = new Map();
    const dupes = [];
    for (const r of registered) {
      if (seen.has(r.name)) dupes.push(`${r.name} in ${seen.get(r.name)} and ${r.file}`);
      else seen.set(r.name, r.file);
    }
    expect(dupes).toEqual([]);
  });

  it('imports every command file in dal/index.js, or its commands are unreachable', () => {
    // A command file that nobody imports registers nothing at runtime, so every
    // call site for it throws "unknown command" — while this file's own scan
    // would still have found it. That gap is exactly what this asserts away.
    const index = readFileSync(path.join(SRC, 'lib', 'dal', 'index.js'), 'utf8');
    const missing = readdirSync(COMMANDS_DIR)
      .filter((f) => f.endsWith('.js'))
      .map((f) => f.replace(/\.js$/, ''))
      .filter((mod) => !index.includes(`./commands/${mod}`));
    expect(missing).toEqual([]);
  });

  it('every outbox-enabled command declares what it does offline', () => {
    // A name in OUTBOX_ENABLED without an `outboxOp` is a half-registration:
    // canQueue refuses it, so the user silently gets the plain offline refusal
    // while the set claims the command is enabled. Catching that here means the
    // two declarations cannot drift apart.
    const enabled = [...readFileSync(path.join(SRC, 'lib', 'dal', 'queueWrite.js'), 'utf8')
      .matchAll(/^\s*'([\w.]+)',$/gm)].map((m) => m[1]);
    expect(enabled.length).toBeGreaterThan(0);

    const declared = new Map();
    for (const file of readdirSync(COMMANDS_DIR)) {
      if (!file.endsWith('.js')) continue;
      const src = readFileSync(path.join(COMMANDS_DIR, file), 'utf8');
      const re = /defineCommand\(\s*'([^']+)'\s*,\s*\{([\s\S]*?)\n\}\);/g;
      let m;
      while ((m = re.exec(src))) declared.set(m[1], m[2]);
    }

    const missingOp = enabled.filter((n) => !/outboxOp:\s*'(insert|update|delete)'/.test(declared.get(n) || ''));
    expect(missingOp).toEqual([]);

    // An enabled INSERT must also declare `invalidates`, or after the flush the
    // optimistic row keeps its `local_` id forever: nothing would refetch to
    // replace it with the server's row.
    const insertsWithoutInvalidates = enabled
      .filter((n) => /outboxOp:\s*'insert'/.test(declared.get(n) || ''))
      .filter((n) => !/invalidates:/.test(declared.get(n) || ''));
    expect(insertsWithoutInvalidates).toEqual([]);
  });

  it('never writes to supabase from a screen — the seam has one entry point', () => {
    // The invariant the whole Phase 0 refactor exists to create. It has eroded
    // twice already: a parallel branch merged in three raw cap RPCs, and the
    // `self_leave` half of the vehicle-delete branch was left un-routed while
    // its sibling `both` branch went through the seam — which this test found.
    //
    // The allowlist below is the ONE documented exception, spelled out rather
    // than skipped silently. Anything else added here needs the same
    // treatment: a reason, in writing, or it is erosion.
    const ALLOWED = [
      // Appendix D, exception 3: bulk mark-read uses `.in('id', ids)`, which
      // needs a command shape the registry does not have yet (every command
      // takes a single row). Routing it would mean inventing that shape for one
      // call site. Deliberate, not an oversight.
      'src/components/shared/NotificationBell.jsx',
    ];
    const offenders = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(cwd(), file).split(path.sep).join('/');
      if (!rel.startsWith('src/pages/') && !rel.startsWith('src/components/')) continue;
      if (ALLOWED.includes(rel)) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        // Writes only. Reads through supabase are still expected in screens.
        if (/supabase\s*\.\s*from\([^)]*\)\s*\.\s*(insert|update|upsert|delete)\b/.test(line)
            || /supabase\.rpc\(\s*'(add|create|delete|update|save|set|bump|sync|revoke|transfer|remove|claim)_/.test(line)) {
          offenders.push(`${rel}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('never lets a conflict-aware command send its base version as a column', () => {
    // baseUpdatedAt is the version being CHECKED, not a field to write. Left in
    // the changes object it reaches sanitizeRow (which validates key NAMES and
    // passes everything through) and then Postgres, as an unknown column. The
    // write fails at the worst moment: on the drain, hours after the user
    // thought it was saved. So every opted-in command must destructure it out.
    const offenders = [];
    for (const file of readdirSync(COMMANDS_DIR)) {
      if (!file.endsWith('.js')) continue;
      const src = readFileSync(path.join(COMMANDS_DIR, file), 'utf8');
      for (const block of src.split('defineCommand(').slice(1)) {
        const body = block.split(String.fromCharCode(10) + '});')[0];
        if (!/conflict:\s*'detect'/.test(body)) continue;
        const name = (block.match(/^\s*'([^']+)'/) || [])[1] || '(unnamed)';
        if (!/run:\s*\(\{[^}]*baseUpdatedAt/.test(body)) offenders.push(name);
      }
    }
    expect(offenders).toEqual([]);
  });
});
