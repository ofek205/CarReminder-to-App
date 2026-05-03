/**
 * Separate Supabase client used ONLY for the password-recovery flow.
 *
 * Why a separate client?
 *
 * The main client (src/lib/supabase.js) uses `flowType: 'pkce'` which
 * is the right choice for normal login + signup + OAuth — PKCE is
 * safer for public clients because the server-issued auth code is
 * paired with a code_verifier that lives only on the originating
 * device.
 *
 * The downside of PKCE for password recovery: the user's reset email
 * arrives with a `pkce_...` prefixed token, and the only way to
 * exchange it for a session is `exchangeCodeForSession(code)` which
 * looks up the code_verifier from `localStorage` of the originating
 * browser. If the user clicks the email link in a different browser,
 * a different device, an incognito window, or after their localStorage
 * was wiped, the verifier is missing → exchange fails → "הקישור פג
 * תוקף" even though the token is still valid.
 *
 * The cross-browser/cross-device case is a real product requirement
 * for forgot-password — people open their email on one device and
 * reset on another all the time.
 *
 * The fix: this client uses `flowType: 'implicit'`, so when called
 * via `supabaseRecovery.auth.resetPasswordForEmail(...)` the email
 * goes out with a regular OTP token (no `pkce_` prefix). On the
 * return trip, `supabaseRecovery.auth.verifyOtp({ token_hash, type:
 * 'recovery' })` validates server-side without needing any browser-
 * local state, then writes a session into the shared storage. The
 * main `supabase` client picks up that session automatically because
 * both clients share the same default storage key.
 *
 * Used by:
 *   - AuthPage.jsx → resetPasswordForEmail (user submits "forgot password")
 *   - AuthPage.jsx → verifyOtp (user clicks the email link)
 *
 * NOT used for: anything else. The main `supabase` client remains the
 * canonical client for the rest of the app.
 */
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Both clients share the same default storage key (project-ref based).
// Earlier this caused a lock-contention crash on the main app: two
// GoTrueClient instances racing on `lock:sb-<project-ref>-auth-token`,
// throwing "Lock was released because another request stole it" and
// breaking Dashboard init. The fix is to make supabaseRecovery a
// stateless throw-away client:
//
//   • persistSession: false   → never reads or writes to storage,
//                                so it can't fight the main client
//                                for the storage lock.
//   • autoRefreshToken: false → no background timer trying to
//                                refresh against shared storage.
//
// We still get a real Session object back from verifyOtp() on the
// return trip; AuthPage.jsx then calls supabase.auth.setSession(...)
// on the MAIN client to install that session into the canonical
// storage. supabaseRecovery itself is fire-and-forget.
export const supabaseRecovery = createClient(url, key, {
  auth: {
    persistSession:     false,
    autoRefreshToken:   false,
    detectSessionInUrl: false,
    flowType:           'implicit',
  },
});
