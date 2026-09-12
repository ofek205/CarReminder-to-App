// Static planning inventory. Reads source text only; never connects to a service.
// Run from the repository root: node docs/admin-console-inventory.cjs
// This is a lexical index, not proof of runtime availability or deployed schema.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const walk = dir => fs.existsSync(path.join(root, dir))
  ? fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(e => {
    const p = `${dir}/${e.name}`;
    return e.isDirectory() ? walk(p) : [p];
  }) : [];
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const hits = (file, regex) => [...read(file).matchAll(regex)].map(m => ({
  name: m[1], file, line: read(file).slice(0, m.index).split('\n').length,
}));
const source = walk('src').filter(p => /\.(jsx?|tsx?)$/.test(p) && !/\.(test|spec)\./.test(p));
const adminFiles = source.filter(p => /^src\/pages\/Admin/.test(p)
  || p === 'src/pages/EmailCenter.jsx' || p.startsWith('src/components/admin/'));
const commandFiles = source.filter(p => p.startsWith('src/lib/dal/commands/'));
const routes = hits('src/pages.config.js', /^\s*"([^"]+)":\s*\w/gm);
const adminRoutes = routes.filter(r => (r.name.startsWith('Admin') && r.name !== 'AdminReviews') || r.name === 'EmailCenter');
const commands = commandFiles.flatMap(p => hits(p, /defineCommand\(\s*['"]([^'"]+)['"]/g));
const calls = adminFiles.flatMap(file => [
  ...hits(file, /\.rpc\(\s*['"]([^'"]+)['"]/g).map(h => ({...h, kind: 'rpc'})),
  ...hits(file, /\.from\(\s*['"]([^'"]+)['"]/g).map(h => ({...h, kind: 'table'})),
  ...hits(file, /\.invoke\(\s*['"]([^'"]+)['"]/g).map(h => ({...h, kind: 'edge'})),
]);
const edgeFunctions = walk('supabase/functions').filter(p => /^supabase\/functions\/[^/]+\/index\.ts$/.test(p));
const flags = source.flatMap(p => hits(p, /(?:useFeatureFlag|isFeatureEnabled)\(\s*['"]([^'"]+)['"]/g));
const sqlFiles = fs.readdirSync(root).filter(p => p.endsWith('.sql'));
const sqlDefinitions = sqlFiles.flatMap(p => hits(p, /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-zA-Z_][a-zA-Z_0-9]*)/gi));
const definitionsByName = {};
sqlDefinitions.forEach(d => (definitionsByName[d.name] ??= []).push(d));
const duplicateSqlDefinitions = Object.fromEntries(Object.entries(definitionsByName).filter(([,defs])=>defs.length>1));
const sourceFingerprints = [...new Set(['src/pages.config.js', ...adminFiles, ...commandFiles, ...edgeFunctions])].sort().map(file=>({
  file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),
}));
const result = {
  inspectedDate: '2026-09-12',
  evidence: 'Static local source only. Comments, dynamic calls, composed routes and SQL application order require manual verification. No production data was read.',
  counts: { literalRoutes: routes.length, adminRoutes: adminRoutes.length, adminSourceFiles: adminFiles.length,
    dalCommands: commands.length, adminCommands: commands.filter(c=>c.name.startsWith('admin.')).length,
    emailAdminCommands: commands.filter(c=>c.name.startsWith('emailAdmin.')).length,
    edgeFunctions: edgeFunctions.length, rootSqlFiles: sqlFiles.length,
    repeatedSqlFunctionNames: Object.keys(duplicateSqlDefinitions).length },
  routes, adminRoutes, commands, adminLiteralCalls: calls, edgeFunctions, featureFlagCallsites: flags,
  duplicateSqlDefinitions, sourceFingerprints,
};
const output = path.join(__dirname, 'admin-console-source-inventory.json');
fs.writeFileSync(output, JSON.stringify(result, null, 2)+'\n');
process.stdout.write(JSON.stringify({output, counts:result.counts}, null, 2)+'\n');
