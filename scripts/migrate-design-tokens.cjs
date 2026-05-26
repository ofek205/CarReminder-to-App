#!/usr/bin/env node
/**
 * migrate-design-tokens.cjs
 *
 * Replaces inline hex color literals in JSX/TSX files with references
 * to the shared `C` design tokens object from @/lib/designTokens.
 *
 * Usage:
 *   node scripts/migrate-design-tokens.cjs src/pages/Dashboard.jsx
 *   node scripts/migrate-design-tokens.cjs src/pages/*.jsx --dry-run
 *   node scripts/migrate-design-tokens.cjs --report         # show top files
 *
 * Flags:
 *   --dry-run   Show what would change without writing
 *   --report    Print per-file violation counts (no file args needed)
 */
const fs = require('fs');
const path = require('path');

// ── Token map: hex → C.tokenName ────────────────────────────────
// Sorted longest-first so #FFFFFF matches before #FFF.
const TOKEN_MAP = {
  // Neutrals
  '#F9FAFB': 'C.gray50',
  '#FAFAFA': 'C.grayBg',
  '#F3F4F6': 'C.gray100',
  '#E5E7EB': 'C.gray200',
  '#D1D5DB': 'C.gray300',
  '#9CA3AF': 'C.gray400',
  '#6B7280': 'C.gray500',
  '#374151': 'C.gray700',
  '#1F2937': 'C.gray800',

  // Brand
  '#2D5233': 'C.primary',
  '#3A6B42': 'C.accent',
  '#E8F2EA': 'C.light',
  '#FFBF00': 'C.yellow',
  '#FFF8E1': 'C.yellowSoft',
  '#7A8A7C': 'C.muted',
  '#D8E5D9': 'C.border',
  '#1C2E20': 'C.text',
  '#0B2912': 'C.primaryDark',
  '#4B5D52': 'C.textAlt',
  '#6B7C72': 'C.mutedAlt',
  '#A7B3AB': 'C.borderAlt',
  '#F0F7F4': 'C.bgSubtle',
  '#E5EDE8': 'C.bgSage',

  // Error
  '#DC2626': 'C.error',
  '#991B1B': 'C.errorDark',
  '#FEF2F2': 'C.errorBg',
  '#FEE2E2': 'C.errorLight',
  '#FECACA': 'C.errorBorder',

  // Warning
  '#D97706': 'C.warn',
  '#92400E': 'C.warnDark',
  '#B45309': 'C.warnMid',
  '#F59E0B': 'C.warnIcon',
  '#FEF3C7': 'C.warnBg',
  '#FDE68A': 'C.warnBorder',
  '#FFFBEB': 'C.warnSubtle',

  // Success
  '#3A7D44': 'C.success',
  '#10B981': 'C.successBright',
  '#065F46': 'C.successDark',
  '#34D399': 'C.successMid',
  '#E8F5E9': 'C.successBg',
  '#D1FAE5': 'C.successLight',
  '#A7F3D0': 'C.successLighter',
  '#ECFDF5': 'C.successSubtle',

  // Info
  '#3B82F6': 'C.info',
  '#1E40AF': 'C.infoDark',
  '#DBEAFE': 'C.infoBg',
  '#EFF6FF': 'C.infoSubtle',

  // Orange
  '#EA580C': 'C.orange',
  '#FFF7ED': 'C.orangeBg',
};

// Build case-insensitive lookup
const LOOKUP = {};
for (const [hex, token] of Object.entries(TOKEN_MAP)) {
  LOOKUP[hex.toUpperCase()] = token;
}

// ── Helpers ─────────────────────────────────────────────────────

function walkDir(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkDir(p));
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) files.push(p);
  }
  return files;
}

function countViolations(content) {
  const hexRx = /#[0-9a-fA-F]{3,8}\b/g;
  let count = 0;
  for (const line of content.split('\n')) {
    if (/^\s*(import|\/\/)/.test(line)) continue;
    if (/<(path|rect|circle|line|polygon|ellipse|svg)\s/.test(line)) continue;
    let m;
    while ((m = hexRx.exec(line)) !== null) {
      if (!LOOKUP[m[0].toUpperCase()]) continue;
      // Skip Tailwind arbitrary values: -[#hex] / [#hex]
      const before = line.slice(Math.max(0, m.index - 2), m.index);
      if (/\[$/.test(before) || /[-=]\[$/.test(before)) continue;
      count++;
    }
  }
  return count;
}

/**
 * Replace inline hex in a file. Only replaces in style={{ }}, config
 * objects, and template literals — NOT in SVG attributes or comments.
 *
 * Returns { original, migrated, replacements }.
 */
function migrateFile(content) {
  const lines = content.split('\n');
  const replacements = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip imports and comments
    if (/^\s*(import|\/\/)/.test(line)) continue;
    // Skip SVG paths — tokenizing SVG inline colors adds complexity
    if (/<(path|rect|circle|line|polygon|ellipse|svg)\s/.test(line)) continue;

    // Replace each hex that has a token, tracking offsets to skip Tailwind brackets
    lines[i] = line.replace(/#[0-9a-fA-F]{3,8}\b/g, (match, offset) => {
      const token = LOOKUP[match.toUpperCase()];
      if (!token) return match;
      // Skip Tailwind arbitrary values: -[#hex] / [#hex] patterns
      const before = line.slice(Math.max(0, offset - 2), offset);
      if (/\[$/.test(before) || /[-=]\[$/.test(before)) return match;
      replacements.push({ line: i + 1, from: match, to: token });
      return '${' + token + '}';
    });

    // Fix the common patterns:
    // 1a. style={{ color: '${C.xxx}' }} → style={{ color: C.xxx }}
    //     When the ENTIRE single-quoted string is just the token reference.
    lines[i] = lines[i].replace(/'(\$\{(C\.[a-zA-Z0-9]+)\})'/g, '$2');
    // 2. JSX prop: ="#{C.xxx}" → ={C.xxx}  (must run before 1b to catch = prefix)
    lines[i] = lines[i].replace(/="(\$\{(C\.[a-zA-Z0-9]+)\})"/g, '={$2}');
    // 1b. Same for double-quoted: "#{C.xxx}" → C.xxx  (object literals, NOT JSX props — those were handled above)
    lines[i] = lines[i].replace(/"(\$\{(C\.[a-zA-Z0-9]+)\})"/g, '$2');
    // 3. Single-quoted strings that still contain ${C.xxx} (mixed content like
    //    '1px solid ${C.border}') — convert to backtick template literals.
    //    Regex: a single-quoted string whose content includes at least one ${C.
    //    We work per-line only so [^'] cannot span across lines.
    lines[i] = lines[i].replace(/'([^']*\$\{C\.[^']*?)'/g, '`$1`');
    // NOTE: We intentionally do NOT convert double-quoted strings with ${C.xxx}
    // to backticks. Double-quoted strings containing ${C.xxx} are usually HTML
    // attributes inside template literals (e.g. style="color:${C.xxx}" inside
    // `<div>...</div>`), where ${} already interpolates via the outer template.
    // Converting "..." to `...` would break the template literal nesting.
  }

  return {
    original: content,
    migrated: lines.join('\n'),
    replacements,
  };
}

/**
 * Check if file imports C from designTokens. If not, add the import.
 * Handles multi-line imports: scans for the last import STATEMENT that
 * completes on a single line (has `from '...'` on the same line).
 * For multi-line imports (`import {\n  ...\n} from '...'`), we find
 * the closing `} from` line and consider that the end of the import.
 */
function ensureImport(content) {
  if (/from\s+['"]@\/lib\/designTokens['"]/.test(content)) return content;
  const lines = content.split('\n');
  // Find the last line that closes an import statement (contains `from '...'` or `from "..."`)
  let lastImportEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/\bfrom\s+['"]/.test(lines[i]) && /^(import\s|.*}\s*from\s)/.test(lines[i].trim())) {
      lastImportEnd = i;
    }
  }
  if (lastImportEnd >= 0) {
    lines.splice(lastImportEnd + 1, 0, "import { C } from '@/lib/designTokens';");
  }
  return lines.join('\n');
}

// ── CLI ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const reportMode = args.includes('--report');

if (reportMode) {
  const srcDir = path.join(process.cwd(), 'src');
  const files = walkDir(srcDir);
  const counts = [];
  for (const f of files) {
    if (f.includes('designTokens')) continue;
    const content = fs.readFileSync(f, 'utf8');
    const c = countViolations(content);
    if (c > 0) counts.push({ file: f.replace(/.*[\\\/]src[\\\/]/, 'src/'), count: c });
  }
  counts.sort((a, b) => b.count - a.count);
  console.log(`Migratable violations: ${counts.reduce((s, c) => s + c.count, 0)} across ${counts.length} files\n`);
  console.log('Top 30:');
  for (const { file, count } of counts.slice(0, 30)) {
    console.log(`${String(count).padStart(4)}  ${file}`);
  }
  process.exit(0);
}

const allMode = args.includes('--all');
let fileArgs = args.filter(a => !a.startsWith('--'));
if (allMode) {
  const srcDir = path.join(process.cwd(), 'src');
  fileArgs = walkDir(srcDir);
}
if (fileArgs.length === 0) {
  console.log('Usage: node scripts/migrate-design-tokens.cjs <file...> [--dry-run]');
  console.log('       node scripts/migrate-design-tokens.cjs --all [--dry-run]');
  console.log('       node scripts/migrate-design-tokens.cjs --report');
  process.exit(1);
}

for (const fileArg of fileArgs) {
  const filePath = path.resolve(fileArg);
  if (!fs.existsSync(filePath)) { console.warn(`SKIP: ${fileArg} not found`); continue; }
  const content = fs.readFileSync(filePath, 'utf8');

  // Skip files that define their own local `const C = {` — migrating
  // them would shadow the import or create circular references.
  if (/^const\s+C\s*=\s*\{/m.test(content) && !/from\s+['"]@\/lib\/designTokens['"]/.test(content)) {
    console.log(`⊘ ${fileArg} — skipped (defines own const C)`);
    continue;
  }
  // Also skip the token definition files themselves
  if (filePath.includes('designTokens') || filePath.includes('design/tokens') || filePath.includes('design\\tokens')) {
    console.log(`⊘ ${fileArg} — skipped (token definition file)`);
    continue;
  }
  const { migrated, replacements } = migrateFile(content);

  if (replacements.length === 0) {
    console.log(`✓ ${fileArg} — no migratable hex found`);
    continue;
  }

  console.log(`${dryRun ? '[DRY RUN] ' : ''}${fileArg} — ${replacements.length} replacements:`);
  for (const r of replacements) {
    console.log(`  L${r.line}: ${r.from} → ${r.to}`);
  }

  if (!dryRun) {
    const withImport = ensureImport(migrated);
    fs.writeFileSync(filePath, withImport, 'utf8');
    console.log(`  ✓ Written\n`);
  }
}
