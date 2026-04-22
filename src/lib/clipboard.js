/**
 * Robust clipboard copy with fallbacks.
 *
 * navigator.clipboard.writeText() fails in several real-world contexts:
 *   - Sandboxed iframes (including the preview/dev host)
 *   - Non-HTTPS on mobile browsers
 *   - WebView without clipboard permission
 *   - User-gesture violations after navigation
 *
 * When the Clipboard API rejects (or throws synchronously), fall back to
 * execCommand('copy') via a hidden textarea. crusty but universally
 * supported. Returns a Promise<boolean> so callers can show correct feedback.
 */
export async function copyToClipboard(text) {
  if (text === undefined || text === null) return false;
  const value = String(text);

  // Try the modern API first
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // fall through to execCommand
    }
  }

  // execCommand fallback
  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    // Off-screen but still focusable
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '-9999px';
    textarea.setAttribute('readonly', '');
    textarea.setAttribute('aria-hidden', 'true');
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand && document.execCommand('copy');
    document.body.removeChild(textarea);
    return !!ok;
  } catch {
    return false;
  }
}
