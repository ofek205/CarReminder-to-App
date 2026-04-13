/**
 * Extract a safe, user-facing error message from any error object.
 * Never exposes stack traces, SQL errors, file paths, or internal IDs.
 */
export function safeErrorMessage(err, fallback = 'אירעה שגיאה. נסה שוב.') {
  if (!err) return fallback;

  const raw = err?.message || String(err);

  // Block internal details from reaching the user
  const blockedPatterns = [
    /stack\s*trace/i,
    /at\s+\w+\s*\(/,           // Stack trace lines
    /\/opt\//i,                 // Server file paths
    /node_modules/i,
    /supabase.*function/i,
    /postgres|pg_|sql/i,        // Database internals
    /user_id\s*=|account_id\s*=/i, // Internal IDs
    /ECONNREFUSED|ETIMEDOUT/i,  // Network internals
    /JWT|token.*invalid/i,      // Auth internals
  ];

  for (const pattern of blockedPatterns) {
    if (pattern.test(raw)) {
      console.error('[SafeError] Blocked internal error:', raw);
      return fallback;
    }
  }

  // If it's a short Hebrew message, it's likely user-facing already
  if (/^[\u0590-\u05FF\s.,!?0-9]{2,80}$/.test(raw)) {
    return raw;
  }

  // Default: hide the raw message
  console.error('[SafeError] Raw error:', raw);
  return fallback;
}
