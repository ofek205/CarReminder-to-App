/**
 * emailTemplates — single source of truth for all branded emails sent from
 * CarReminder. Any HTML that reaches a user's inbox should be built via
 * `buildEmailHtml(...)` so the look & feel stays consistent.
 *
 * Palette, spacing and typography mirror the in-app design tokens
 * (src/lib/designTokens.js) — forest green gradient, soft cream backdrop,
 * rounded cards, heavy titles, calm body.
 *
 * The same template file is also used as the basis for the Supabase Auth
 * email templates under `supabase/email-templates/` — keep them in sync.
 */

// ── Brand palette ──────────────────────────────────────────────────────────
// Deliberately copied (not imported from designTokens) so that any HTML
// generated here stays self-contained: email clients strip <style> tags
// aggressively, so we inline everything.
export const EMAIL_BRAND = {
  primary:    '#2D5233',
  accent:     '#3A6B42',
  gradient:   'linear-gradient(135deg,#2D5233 0%,#3A6B42 100%)',
  softBg:     '#F4F7F3',        // page background tone
  card:       '#FFFFFF',
  infoBg:     '#F0FDF4',
  infoBorder: '#BBF7D0',
  infoText:   '#166534',
  codeBg:     '#FAFDF6',
  codeBorder: '#D8E5D9',
  codeText:   '#1C3620',
  text:       '#1F2937',
  textDim:    '#6B7280',
  textMute:   '#9CA3AF',
  hr:         '#E5E7EB',
  year:       new Date().getFullYear(),
  appName:    'CarReminder',
  tagline:    'ניהול חכם של כלי רכב',
  supportMail:'support@car-reminder.app',
  siteUrl:    'https://car-reminder.app',
  logoUrl:    'https://car-reminder.app/icons/email-logo.png',
};

// ── HTML escape ────────────────────────────────────────────────────────────
// Used everywhere we interpolate user-supplied strings into the template.
export function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Building blocks ────────────────────────────────────────────────────────

// Card the user sees as the "gentle highlight" — used for invite details,
// one-line context, etc.
export function infoBox(html) {
  return `<div style="background:${EMAIL_BRAND.infoBg};border:1.5px solid ${EMAIL_BRAND.infoBorder};border-radius:16px;padding:18px 20px;margin:0 0 24px;color:${EMAIL_BRAND.infoText};font-size:15px;line-height:1.7">${html}</div>`;
}

// Primary CTA button.
// Built as a table so Outlook renders it; uses `bgcolor` as a solid-colour
// fallback for clients that drop the gradient, and puts the padding on the
// <td> (Outlook ignores padding on <a>).
export function ctaButton(label, href) {
  const safeLabel = escapeHtml(label);
  const safeHref = escapeHtml(href);
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto">
      <tr>
        <td align="center" bgcolor="${EMAIL_BRAND.primary}" style="border-radius:14px;background:${EMAIL_BRAND.gradient};padding:16px 40px;mso-padding-alt:16px 40px;box-shadow:0 8px 20px rgba(45,82,51,0.25)">
          <a href="${safeHref}" target="_blank" style="color:#FFFFFF;font-size:16px;font-weight:800;text-decoration:none;line-height:1.2">
            ${safeLabel}&nbsp;&#8592;
          </a>
        </td>
      </tr>
    </table>`;
}

// 6-digit verification code rendered as a big tappable "copy pill".
// Since email clients don't run JavaScript, we can't wire a real
// navigator.clipboard button. We fake it with user-select:all — one
// tap/click selects the whole code so Ctrl/Cmd+C (or long-press →
// Copy on mobile) finishes the job. This is the exact pattern Google,
// Stripe and Apple use in their OTP emails.
export function codeBox(code) {
  const safeCode = escapeHtml(code);
  return `
    <div style="text-align:center;margin:8px 0 20px">
      <div style="font-size:13px;color:${EMAIL_BRAND.textDim};margin:0 0 10px;font-weight:600">קוד אימות</div>
      <div dir="ltr" style="display:inline-block;background:${EMAIL_BRAND.codeBg};border:2px solid ${EMAIL_BRAND.codeBorder};border-radius:16px;padding:18px 32px;font-size:34px;font-weight:900;letter-spacing:10px;color:${EMAIL_BRAND.codeText};font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;user-select:all;-webkit-user-select:all;-moz-user-select:all;-ms-user-select:all;cursor:pointer">
        ${safeCode}
      </div>
      <div style="font-size:12px;color:${EMAIL_BRAND.textMute};margin:10px 0 0">
        לחצ/י על הקוד כדי לסמן ולהעתיק
      </div>
    </div>`;
}

// Fallback link ("or copy this link to your browser") under the CTA.
export function fallbackLink(href, label = 'או העתק/י את הקישור לדפדפן:') {
  const safe = escapeHtml(href);
  return `
    <p style="font-size:12px;color:${EMAIL_BRAND.textMute};text-align:center;margin:22px 0 4px">${escapeHtml(label)}</p>
    <p style="font-size:12px;word-break:break-all;text-align:center;margin:0 0 8px;color:${EMAIL_BRAND.textDim}">
      <a href="${safe}" style="color:${EMAIL_BRAND.primary};text-decoration:underline">${safe}</a>
    </p>`;
}

// ── Full-page shell ────────────────────────────────────────────────────────
/**
 * buildEmailHtml({ preheader, title, subtitle, bodyHtml, footerNote })
 *
 * Returns a complete `<html>…</html>` document ready to pass as the `html`
 * field to Resend. `bodyHtml` should be pre-rendered HTML (typically built
 * from `infoBox`, `ctaButton`, `codeBox`, `fallbackLink`).
 *
 * - `preheader` is the preview snippet shown in Gmail/Outlook inbox lists.
 *   Keep it under ~90 chars and do not include sensitive data.
 */
export function buildEmailHtml({
  preheader = '',
  title,
  subtitle = EMAIL_BRAND.tagline,
  bodyHtml,
  footerNote = '',
}) {
  const safePreheader = escapeHtml(preheader);
  const safeTitle = escapeHtml(title);
  const safeSubtitle = escapeHtml(subtitle);
  const safeFooterNote = footerNote; // caller may pass HTML intentionally

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background:${EMAIL_BRAND.softBg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${EMAIL_BRAND.text};direction:rtl">
  <!-- Preview text shown by Gmail/Outlook in the inbox list. The trailing
       invisible characters pad it so body content doesn't leak in. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px">
    ${safePreheader}&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;
  </div>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${EMAIL_BRAND.softBg};padding:32px 16px">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background:${EMAIL_BRAND.card};border-radius:24px;box-shadow:0 6px 28px rgba(17,34,22,0.06);overflow:hidden">
          <!-- Header -->
          <tr>
            <td align="center" style="padding:36px 28px 8px">
              <img src="${EMAIL_BRAND.logoUrl}" alt="CarReminder" width="72" height="72" style="display:block;width:72px;height:72px;border-radius:22px;margin:0 auto;box-shadow:0 6px 18px rgba(45,82,51,0.18)">
              <h1 style="font-size:24px;font-weight:900;color:${EMAIL_BRAND.codeText};margin:20px 0 6px">
                ${safeTitle}
              </h1>
              <p style="font-size:14px;color:${EMAIL_BRAND.textDim};margin:0">
                ${safeSubtitle}
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:24px 28px 8px;font-size:15px;line-height:1.75;color:${EMAIL_BRAND.text};direction:rtl;text-align:right">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:8px 28px 32px">
              <hr style="border:none;border-top:1px solid ${EMAIL_BRAND.hr};margin:20px 0">
              ${safeFooterNote ? `<p style="font-size:12px;color:${EMAIL_BRAND.textMute};text-align:center;margin:0 0 12px;line-height:1.7">${safeFooterNote}</p>` : ''}
              <p style="font-size:11px;color:${EMAIL_BRAND.textMute};text-align:center;margin:0;line-height:1.7">
                ${EMAIL_BRAND.appName} &middot; ${EMAIL_BRAND.tagline}<br>
                נשלח מ-<a href="mailto:${EMAIL_BRAND.supportMail}" style="color:${EMAIL_BRAND.textDim};text-decoration:underline">${EMAIL_BRAND.supportMail}</a>
                &nbsp;&middot;&nbsp;
                <a href="${EMAIL_BRAND.siteUrl}" style="color:${EMAIL_BRAND.textDim};text-decoration:underline">car-reminder.app</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Ready-made builders
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Invite email — sent when an admin invites a family member to their
 * CarReminder account. Called from AccountSettings.
 */
export function buildInviteEmail({ inviterName, roleLabel, inviteLink }) {
  const bodyHtml = `
    ${infoBox(`
      <p style="margin:0 0 6px"><strong>${escapeHtml(inviterName)}</strong> הוסיף/ה אותך לחשבון הרכבים ב-CarReminder.</p>
      <p style="margin:0">רמת הגישה שלך: <strong>${escapeHtml(roleLabel)}</strong></p>
    `)}

    <p style="margin:0 0 8px">אחרי ההצטרפות תוכל/י לצפות ברכבים, לקבל תזכורות לטיפולים ורישיונות, ולעזור בניהול המסמכים של המשפחה.</p>

    <div style="margin:28px 0 8px">
      ${ctaButton('הצטרפות לחשבון', inviteLink)}
    </div>

    ${fallbackLink(inviteLink)}
  `;

  return buildEmailHtml({
    preheader: `${inviterName} מזמין/ה אותך. הקישור תקף 7 ימים`,
    title: 'הוזמנת ל-CarReminder',
    subtitle: 'ניהול חכם של כלי רכב',
    bodyHtml,
    footerNote: 'הקישור תקף ל-7 ימים וניתן לשימוש פעם אחת בלבד.<br>אם לא ציפית להזמנה, אפשר להתעלם ממייל זה.',
  });
}

/**
 * Plain-text counterpart for clients that don't render HTML.
 */
export function buildInviteText({ inviterName, roleLabel, inviteLink }) {
  return [
    `${inviterName} הוסיף/ה אותך לחשבון הרכבים ב-CarReminder כ-${roleLabel}.`,
    '',
    'קישור להצטרפות (תקף 7 ימים):',
    inviteLink,
    '',
    'אם לא ציפית להזמנה, אפשר להתעלם ממייל זה.',
  ].join('\n');
}
