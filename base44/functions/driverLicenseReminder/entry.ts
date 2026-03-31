import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // This runs as a scheduled job, use service role
    const profiles = await base44.asServiceRole.entities.UserProfile.list();
    const today = new Date();

    for (const profile of profiles) {
      if (!profile.license_expiration_date || !profile.user_id) continue;

      const expiry = new Date(profile.license_expiration_date);
      const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));

      if (daysLeft !== 30 && daysLeft !== 7) continue;

      // Check for existing notification to avoid duplicates
      const dedupe_key = `driver_license_${profile.user_id}_${daysLeft}d_${profile.license_expiration_date}`;
      const existing = await base44.asServiceRole.entities.NotificationsLog.filter({ dedupe_key });
      if (existing.length > 0) continue;

      const formattedDate = expiry.toLocaleDateString('he-IL');

      // Create in-app notification
      await base44.asServiceRole.entities.NotificationsLog.create({
        user_id: profile.user_id,
        vehicle_id: 'driver_license',
        notification_type: 'מסמך',
        due_date: profile.license_expiration_date,
        trigger_date: today.toISOString().split('T')[0],
        dedupe_key,
        message: `תוקף רישיון הנהיגה שלך עומד להסתיים בתאריך ${formattedDate} (${daysLeft} ימים)`,
        is_read: false,
      });

      // Get user email for sending email notification
      const users = await base44.asServiceRole.entities.User.filter({ id: profile.user_id });
      const user = users[0];
      if (!user?.email) continue;

      // Check reminder settings
      const settings = await base44.asServiceRole.entities.ReminderSettings.filter({ user_id: profile.user_id });
      const emailEnabled = settings.length === 0 || settings[0].remind_maintenance_days_before !== -1; // send by default

      if (emailEnabled) {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: user.email,
          subject: 'תזכורת – תוקף רישיון הנהיגה מתקרב',
          body: `שלום ${user.full_name || ''},\n\nשמנו לב שתוקף רישיון הנהיגה שלך עומד להסתיים בתאריך:\n\n${formattedDate}\n\nמומלץ לחדש אותו בהקדם.\n\nהאפליקציה לניהול רכבים`,
        });
      }
    }

    return Response.json({ success: true, checked: profiles.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});