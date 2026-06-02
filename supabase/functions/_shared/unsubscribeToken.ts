// ════════════════════════════════════════════════════════════════════════
// unsubscribeToken — stateless, login-free unsubscribe link tokens.
//
// A marketing email's unsubscribe link carries `?token=<payload>.<sig>` where
//   payload = base64url(user_id)
//   sig     = hex( HMAC-SHA256(user_id, UNSUBSCRIBE_SECRET) )
//
// The SENDER (dispatch-broadcast / dispatch-no-vehicle-nudge) builds the token;
// the `unsubscribe` function verifies it by recomputing the HMAC. No token is
// stored in the DB — the signature itself proves the link is genuine, so it
// can't be forged to opt OTHER users out, and it works without any login.
//
// Both sides must share the same UNSUBSCRIBE_SECRET edge-function secret.
// ════════════════════════════════════════════════════════════════════════

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecodeToStr(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded);
}

async function hmacHex(msg: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function buildUnsubscribeToken(userId: string, secret: string): Promise<string> {
  const payload = b64urlEncode(enc.encode(userId));
  const sig = await hmacHex(userId, secret);
  return `${payload}.${sig}`;
}

// Returns the verified user_id, or null if the token is missing/malformed/forged.
export async function verifyUnsubscribeToken(token: string, secret: string): Promise<string | null> {
  const parts = (token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  let userId: string;
  try { userId = b64urlDecodeToStr(parts[0]); } catch { return null; }
  if (!userId) return null;
  const expected = await hmacHex(userId, secret);
  // Constant-time comparison — avoid leaking signature bytes via timing.
  if (parts[1].length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= parts[1].charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? userId : null;
}
