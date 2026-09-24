/**
 * postinstall: two jobs with OPPOSITE failure policies, which is why this is a
 * script and not a one-liner in package.json.
 *
 * 1. Point git at .githooks. BEST EFFORT, exactly as the old one-liner was
 *    (`git config ... 2>/dev/null || true`). A machine without git, or a CI
 *    checkout without a repo, must still install.
 *
 * 2. Apply patches/ with patch-package. MUST FAIL LOUDLY.
 *    The only patch today is @capgo/native-purchases, which makes the plugin
 *    keep Google's per-product reason when a catalogue comes back empty
 *    (Billing Library 8's getUnfetchedProductList, which upstream discards).
 *    If a plugin upgrade makes that patch stop applying, the install has to
 *    break: the alternative is a build that silently ships without it and
 *    reports "Product not found" with no reason again.
 *
 * ⚠️ WHY NOT `a || true; b` IN package.json: npm runs scripts through cmd.exe
 * on Windows and sh on the Ubuntu CI runner, and those two disagree on `;`,
 * `2>/dev/null` and `true`. A node script behaves the same on both.
 */

const { execSync, execFileSync } = require('child_process');
const path = require('path');

try {
  execSync('git config core.hooksPath .githooks', { stdio: 'ignore' });
} catch {
  // Deliberately ignored; see (1).
}

/**
 * ⚠️ RESOLVED EXPLICITLY, NOT BY NAME ON PATH, AND THE FIRST VERSION GOT THIS
 * WRONG. It ran `patch-package` bare, trusting npm to put node_modules/.bin on
 * PATH. npm does that inside a lifecycle script, but not when the script is run
 * any other way, so the first test outside npm failed with "not recognized".
 * That would probably have passed in CI, and "probably" is not something to
 * ship into the one step that decides whether the patch is in the build.
 *
 * Reading the bin entry from patch-package's own package.json survives a
 * version bump that moves its entry file, and runs it with the same node.
 * No try/catch, see (2).
 */
const pkgJsonPath = require.resolve('patch-package/package.json');
const pkg = require(pkgJsonPath);
const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin['patch-package'];
const bin = path.join(path.dirname(pkgJsonPath), binRel);

/**
 * ⚠️ --error-on-fail IS THE WHOLE OF POLICY (2), AND WITHOUT IT (2) WAS FALSE.
 *
 * Tested by breaking the patch context on purpose: patch-package printed
 * "**ERROR** Failed to apply patch" and "finished with 1 error(s)", and then
 * EXITED 0. That is its documented default outside CI, and inside CI it only
 * exits 1 when the CI environment variable happens to be set. So a patch that
 * stopped applying would have passed the install and shipped a build without
 * it, silently, which is the exact outcome this script exists to prevent.
 * The flag makes the failure loud everywhere instead of depending on an
 * environment variable nobody is watching.
 */
execFileSync(process.execPath, [bin, '--error-on-fail'], { stdio: 'inherit' });
