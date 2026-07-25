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
/**
 * Sender for invites to someone who ALREADY has an account (PATH A of
 * invite_account_member_by_email).
 *
 * Those invites mint no token: the RPC writes a 'ממתין' membership plus an
 * in-app notification, and the invitee approves via accept_account_invite.
 * sendAccountInviteEmail() can't serve this case — it builds a
 * /JoinInvite?token= link, and redeeming a token sets status straight to
 * 'פעיל', which would bypass the approve/decline step the pending row
 * exists to enforce.
 *
 * So this variant carries no token and points at the app, where the
 * pending-invite banner and the notification bell both offer the real
 * accept/decline action. Without it a registered invitee got no email at
 * all — only an in-app notification they had to happen to notice — while
 * the inviter saw a confident "ההזמנה נשלחה".
 *
 * Best-effort, like its sibling: a mail failure must never break the
 * invite itself, which is already committed server-side by this point.
 */
export async function sendPendingInviteEmail(toEmail, roleLabel = 'חבר', inviterName = 'משתמש CarReminder') {
  if (!toEmail) return;
  try {
    const { sendEmail, sendTemplatedEmail } = await import('@/lib/sendEmail');
    const PUBLIC_DOMAIN = import.meta.env.VITE_PUBLIC_APP_URL || 'https://car-reminder.app';
    const link = `${PUBLIC_DOMAIN}/Notifications`;
    try {
      await sendTemplatedEmail('invite', {
        to: toEmail,
        vars: { inviterName, roleLabel, inviteLink: link },
      });
    } catch (e) {
      if (e?.name === 'EmailsPausedError') throw e;
      const { buildInviteEmail, buildInviteText } = await import('@/lib/emailTemplates');
      const subject = 'הוזמנת להצטרף לחשבון ב-CarReminder';
      const html = buildInviteEmail({ inviterName, roleLabel, inviteLink: link });
      const text = buildInviteText({ inviterName, roleLabel, inviteLink: link });
      await sendEmail({ to: toEmail, subject, html, text, notificationKey: 'invite' });
    }
  } catch { /* best-effort */ }
}

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
