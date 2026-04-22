/**
 * emailRender. the glue between a DB-stored email template (editable by
 * admins) and the final HTML that goes to Resend.
 *
 * Pipeline:
 *   notification_key + vars
 *     → fetchTemplate()      . SELECT from email_templates via RPC
 *     → renderPlaceholders   . {{x}} → vars.x (or literal if missing)
 *     → buildEmailHtml()     . wrap in the brand shell (logo, footer, …)
 *     → { subject, html, text, fromName, fromEmail, replyTo }
 *
 * Also exposes renderFromTemplateObject() for the admin preview UI 
 * same render path but takes the unsaved template object directly.
 *
 * Feature flag: VITE_USE_DB_TEMPLATES. When false/unset, renderEmail()
 * throws and the caller is expected to fall back to its own builder
 * (e.g. buildInviteEmail from emailTemplates.js). This is the
 * rollback path from the architect review.
 */

import { supabase } from './supabase';
import { buildEmailHtml, escapeHtml, EMAIL_BRAND } from './emailTemplates';
import { renderPlaceholders } from './emailValidate';

export const DB_TEMPLATES_ENABLED =
  String(import.meta.env.VITE_USE_DB_TEMPLATES || '').toLowerCase() === 'true';

//  Internal helpers 

// Escape every value in the vars map before it gets substituted into the
// HTML body. URLs get a looser treatment (escape only ", <, > to keep
// query-strings intact). Call sites that WANT raw HTML inside a value
// (e.g. a bolded name already marked safe) can pass `{ raw: { key: '<b>x</b>' }}`
// via the `rawVars` option. but by default everything is escaped.
function escapeValuesForHtml(vars = {}, rawVars = {}) {
  const out = {};
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined || v === null) { out[k] = ''; continue; }
    out[k] = rawVars && k in rawVars ? String(rawVars[k]) : escapeHtml(String(v));
  }
  return out;
}

// Plain-text variant for the `text/plain` part of the email. No escaping
// since text/plain doesn't render HTML.
function plainVars(vars = {}) {
  const out = {};
  for (const [k, v] of Object.entries(vars)) {
    out[k] = v === undefined || v === null ? '' : String(v);
  }
  return out;
}

//  Public API 

/**
 * Fetch a template row by notification key. Uses the SECURITY DEFINER
 * function get_email_template() so both logged-in users and anon callers
 * (via the Edge Function) can retrieve it, without bumping into the
 * RLS that locks the underlying table.
 *
 * Returns the template object or null if not found / notification disabled.
 */
export async function fetchTemplate(notificationKey) {
  const { data, error } = await supabase.rpc('get_email_template', { p_key: notificationKey });
  if (error) throw new Error(`fetchTemplate(${notificationKey}): ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  if (row.enabled === false) return { ...row, _disabled: true };
  return row;
}

/**
 * Render a template object (from DB or an unsaved editor draft) into the
 * full email payload ready for Resend.
 *
 * @param {object} template . row from email_templates (or in-memory draft)
 * @param {object} vars     . values for the {{placeholders}}
 * @param {object} options
 *   - rawVars: map of keys whose value should NOT be escaped (caller has
 *              already produced trusted HTML). Use sparingly.
 *   - subtitle: override the default subtitle (tagline) under the title
 *
 * @returns {{ subject, html, text, fromName, fromEmail, replyTo }}
 */
export function renderFromTemplateObject(template, vars = {}, options = {}) {
  if (!template) throw new Error('renderFromTemplateObject: template is required');
  const { rawVars = {}, subtitle } = options;

  const htmlVars = escapeValuesForHtml(vars, rawVars);
  const txtVars  = plainVars(vars);

  const subject     = renderPlaceholders(template.subject || '', txtVars);
  const preheader   = renderPlaceholders(template.preheader || '', txtVars);
  const title       = renderPlaceholders(template.title || '', txtVars);
  const bodyHtmlRaw = renderPlaceholders(template.body_html || '', htmlVars);
  // cta_label and cta_url get inserted into HTML (anchor text + href). Values
  // were already HTML-escaped when we built htmlVars, so variable content is
  // safe. but the template author's own cta_label text gets inlined as-is.
  // That's intentional (admin is trusted and may want &nbsp; / emoji codes).
  const ctaLabel    = renderPlaceholders(template.cta_label || '', htmlVars);
  const ctaUrl      = renderPlaceholders(template.cta_url || '', htmlVars);
  const footerNote  = renderPlaceholders(template.footer_note || '', htmlVars);

  // Compose the body: admin-authored paragraphs, then (if present) a CTA
  // button, then a plain-text copy-the-link fallback.
  const hasCta = ctaLabel && ctaUrl;
  const ctaBlock = hasCta
    ? `
      <div style="margin:24px 0 16px">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto">
          <tr>
            <td align="center" bgcolor="${EMAIL_BRAND.primary}" style="border-radius:14px;background:${EMAIL_BRAND.gradient};padding:16px 40px;mso-padding-alt:16px 40px;box-shadow:0 8px 20px rgba(45,82,51,0.25)">
              <a href="${ctaUrl}" target="_blank" style="color:#FFFFFF;font-size:16px;font-weight:800;text-decoration:none;line-height:1.2">
                ${ctaLabel}&nbsp;&#8592;
              </a>
            </td>
          </tr>
        </table>
      </div>
      <p style="font-size:12px;color:${EMAIL_BRAND.textMute};text-align:center;margin:22px 0 4px">או העתק/י את הקישור לדפדפן:</p>
      <p style="font-size:12px;word-break:break-all;text-align:center;margin:0 0 8px;color:${EMAIL_BRAND.textDim}">
        <a href="${ctaUrl}" style="color:${EMAIL_BRAND.primary};text-decoration:underline">${ctaUrl}</a>
      </p>`
    : '';

  const bodyHtml = bodyHtmlRaw + ctaBlock;

  const html = buildEmailHtml({
    preheader,
    title,
    subtitle: subtitle || EMAIL_BRAND.tagline,
    bodyHtml,
    footerNote,
  });

  // Build a simple plain-text counterpart. strip tags, collapse whitespace.
  const textBody = bodyHtmlRaw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const text = [
    title,
    '',
    textBody,
    hasCta ? `\n${ctaLabel}: ${ctaUrl}` : '',
  ].filter(Boolean).join('\n');

  return {
    subject,
    html,
    text,
    fromName: template.from_name || 'CarReminder',
    fromEmail: template.from_email || 'no-reply@car-reminder.app',
    replyTo: template.reply_to || null,
  };
}

/**
 * End-to-end: fetch + render. Throws if DB templates are disabled via
 * feature flag. caller should catch and fall back to its own builder.
 */
export async function renderEmail(notificationKey, vars = {}, options = {}) {
  if (!DB_TEMPLATES_ENABLED) {
    throw new Error('DB_TEMPLATES_DISABLED');
  }
  const template = await fetchTemplate(notificationKey);
  if (!template) throw new Error(`Template not found for notification "${notificationKey}"`);
  if (template._disabled) throw new Error(`Notification "${notificationKey}" is disabled by admin`);
  return renderFromTemplateObject(template, vars, options);
}

/**
 * Check the global kill switch. Returns { paused: bool, reason?: string }.
 * Called by sendEmail() before every dispatch (1ms SELECT, no caching 
 * the whole point of a kill switch is immediate effect).
 */
export async function getKillSwitchState() {
  const { data, error } = await supabase
    .from('email_settings')
    .select('emails_paused, pause_reason')
    .eq('id', 1)
    .maybeSingle();
  if (error) {
    // If we can't read the table (not an admin, RLS blocks), assume not
    // paused. the Edge Function will enforce server-side anyway when we
    // add that check in Phase 2. Admin UI is the only place that needs
    // the full state.
    return { paused: false, reason: null, readable: false };
  }
  return {
    paused: !!data?.emails_paused,
    reason: data?.pause_reason || null,
    readable: true,
  };
}
