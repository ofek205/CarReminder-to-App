/**
 * Shared best-effort sender for account-invite emails.
 *
 * Used by:
 *   - InviteAccountMemberDialog (manual "invite to account" flow)
 *   - CreateBusinessWorkspace (auto-invite the requester's pre-attached team
 *     when their business account is approved)
 *
 * Prefers the templated pipeline; falls back to a hand-built email. Always
 * resolves — a mail failure must never break the invite flow itself.
 */
export async function sendAccountInviteEmail(toEmail, inviteToken, roleLabel = 'חבר') {
  if (!toEmail || !inviteToken) return;
  try {
    const { sendEmail, sendTemplatedEmail } = await import('@/lib/sendEmail');
    const PUBLIC_DOMAIN = import.meta.env.VITE_PUBLIC_APP_URL || 'https://car-reminder.app';
    const link = `${PUBLIC_DOMAIN}/JoinInvite?token=${inviteToken}&type=account`;
    try {
      await sendTemplatedEmail('invite', {
        to: toEmail,
        vars: { inviterName: 'משתמש CarReminder', roleLabel, inviteLink: link },
      });
    } catch (e) {
      if (e?.name === 'EmailsPausedError') throw e;
      const { buildInviteEmail, buildInviteText } = await import('@/lib/emailTemplates');
      const subject = 'הוזמנת להצטרף לחשבון ב-CarReminder';
      const html = buildInviteEmail({ inviterName: 'משתמש', roleLabel, inviteLink: link });
      const text = buildInviteText({ inviterName: 'משתמש', roleLabel, inviteLink: link });
      await sendEmail({ to: toEmail, subject, html, text, notificationKey: 'invite' });
    }
  } catch { /* best-effort */ }
}
