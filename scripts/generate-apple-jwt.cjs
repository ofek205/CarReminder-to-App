#!/usr/bin/env node
/**
 * generate-apple-jwt.cjs
 *
 * Generates the JWT "client secret" that Supabase's Apple Provider config
 * expects in its "Secret Key (for OAuth)" field. The newer Supabase UI no
 * longer asks for Team ID / Key ID separately — instead you paste a JWT
 * signed with your Apple .p8 private key.
 *
 * Apple specifies the JWT contents in
 * https://developer.apple.com/documentation/sign_in_with_apple/generate_and_validate_tokens
 *
 * Maximum allowed expiry is 6 months. Apple WILL reject longer values, so
 * we cap at 6 months here. Bookmark a calendar reminder to regenerate
 * before expiry — Supabase users will get OAuth errors otherwise.
 *
 * Usage:
 *   node scripts/generate-apple-jwt.cjs <path-to-.p8>
 *
 * Example:
 *   node scripts/generate-apple-jwt.cjs ~/Downloads/AuthKey_LQ275YW4QP.p8
 *
 * Constants below are filled in for the CarReminder project; update if you
 * regenerate the key with a different Key ID, or if the Team ID / Services
 * ID ever changes.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// === CarReminder constants =================================================
// Team ID — visible at developer.apple.com/account#MembershipDetailsCard
const TEAM_ID = 'L36CBSRNZT';

// Key ID — the 10-char suffix on the .p8 file you downloaded
// (e.g. AuthKey_LQ275YW4QP.p8 → LQ275YW4QP). Auto-detect from filename
// if not overridden; falls back to this constant.
const DEFAULT_KEY_ID = 'LQ275YW4QP';

// Services ID — the Identifier you registered in Apple Dev → Identifiers →
// Services IDs. Apple's docs call this the "client_id" for the JWT.
const SERVICES_ID = 'com.carreminders.app.signin';
// ===========================================================================

const p8Path = process.argv[2];
if (!p8Path) {
  console.error('Usage: node scripts/generate-apple-jwt.cjs <path-to-.p8>');
  process.exit(1);
}
if (!fs.existsSync(p8Path)) {
  console.error(`File not found: ${p8Path}`);
  process.exit(1);
}

// Try to extract Key ID from the filename — Apple names the file
// "AuthKey_<KEY_ID>.p8" so the heuristic is safe; fallback to constant.
const basename = path.basename(p8Path, '.p8');
const m = basename.match(/^AuthKey_([A-Z0-9]{10})$/i);
const KEY_ID = m ? m[1].toUpperCase() : DEFAULT_KEY_ID;

const privateKey = fs.readFileSync(p8Path, 'utf8');

// Apple's JWT spec (Sign in with Apple):
//   alg: ES256, kid: <Key ID> in header
//   iss: <Team ID>, iat: now, exp: now + (<= 6 months), aud: https://appleid.apple.com,
//   sub: <Services ID> in payload
const SIX_MONTHS_SECONDS = 60 * 60 * 24 * 180; // 180 days — Apple's hard ceiling
const now = Math.floor(Date.now() / 1000);

const header = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' };
const payload = {
  iss: TEAM_ID,
  iat: now,
  exp: now + SIX_MONTHS_SECONDS,
  aud: 'https://appleid.apple.com',
  sub: SERVICES_ID,
};

// Base64url (no padding, URL-safe). The native Buffer.toString('base64')
// uses standard base64 — we have to strip = and swap + / → - _ manually.
// Accepts three input shapes:
//   - string  → encode UTF-8 bytes of the string
//   - Buffer  → encode the raw bytes (signature path — MUST NOT JSON-stringify
//               the Buffer; that produced {"type":"Buffer","data":[…]} and
//               broke the JWS signature validation entirely)
//   - object  → encode the JSON serialization (header/payload path)
function b64url(input) {
  let buf;
  if (Buffer.isBuffer(input)) buf = input;
  else if (typeof input === 'string') buf = Buffer.from(input);
  else buf = Buffer.from(JSON.stringify(input));
  return buf
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

const signingInput = `${b64url(header)}.${b64url(payload)}`;

// ES256 = ECDSA with P-256 + SHA-256. Node's `crypto.sign` returns DER-encoded
// (r, s) — JWS wants raw concatenation r || s (each 32 bytes for P-256). We
// pass `dsaEncoding: 'ieee-p1363'` to get the raw form directly; this option
// has been stable since Node 13 and the project pins Node 22.
const signature = crypto.sign('SHA256', Buffer.from(signingInput), {
  key: privateKey,
  dsaEncoding: 'ieee-p1363',
});

const jwt = `${signingInput}.${b64url(signature)}`;

// Print just the JWT on stdout so the user can pipe it into clipboard:
//   node scripts/generate-apple-jwt.cjs key.p8 | clip   (Windows)
//   node scripts/generate-apple-jwt.cjs key.p8 | pbcopy (macOS)
console.log(jwt);

// Friendly summary to stderr so piping to clip still works.
console.error('');
console.error('=== Apple Sign In JWT generated ===');
console.error(`Team ID:      ${TEAM_ID}`);
console.error(`Key ID:       ${KEY_ID}`);
console.error(`Services ID:  ${SERVICES_ID}`);
console.error(`Issued at:    ${new Date(now * 1000).toISOString()}`);
console.error(`Expires at:   ${new Date((now + SIX_MONTHS_SECONDS) * 1000).toISOString()}`);
console.error('');
console.error('Paste the JWT above (the only line on stdout) into');
console.error('Supabase Dashboard → Auth → Providers → Apple → Secret Key (for OAuth).');
console.error('');
console.error('⚠️  Apple caps JWT lifetime at 6 months. Regenerate before',
              new Date((now + SIX_MONTHS_SECONDS) * 1000).toLocaleDateString());
console.error('    or web sign-in users will start getting OAuth errors.');
