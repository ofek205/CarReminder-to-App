package com.carreminder.app.tripguard;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;

/**
 * Fires the "check the car" safety alert — a HIGH-importance, vibrating
 * notification with two actions ("checked" / "no kids this trip"), plus a
 * one-time escalation: if the user doesn't act within 30s, it re-fires with a
 * stronger buzz. Built natively (not @capacitor/local-notifications) because
 * it must fire from a BroadcastReceiver while the WebView/JS is dead.
 */
public final class TripGuardNotifier {

    private static final String CHANNEL_ID = "trip-guard-safety";
    public static final int NOTIF_ID = 920601;

    public static final String ACTION_ACK = "com.carreminder.app.tripguard.ACK";
    public static final String ACTION_NO_KIDS = "com.carreminder.app.tripguard.NO_KIDS";
    public static final String ACTION_ESCALATE = "com.carreminder.app.tripguard.ESCALATE";

    private static final long[] VIBRATION = { 0, 400, 200, 400, 200, 600 };
    private static final long[] VIBRATION_STRONG = { 0, 600, 150, 600, 150, 600, 150, 800 };
    private static final long ESCALATE_AFTER_MS = 30_000L;

    private TripGuardNotifier() {}

    /** First alert + schedule a single escalation if not acknowledged. */
    public static void fireCheckCarAlert(Context ctx) {
        showNotification(ctx, false);
        scheduleEscalation(ctx);
    }

    /** Re-fire (stronger) when the escalation alarm goes off. No re-schedule. */
    public static void fireEscalated(Context ctx) {
        showNotification(ctx, true);
    }

    /** User acted (checked / no kids) — clear the alert and any pending escalation. */
    public static void cancelAlert(Context ctx) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(NOTIF_ID);
        cancelEscalation(ctx);
    }

    private static void showNotification(Context ctx, boolean escalated) {
        ensureChannel(ctx);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(smallIcon(ctx))
            .setContentTitle(escalated ? "עדיין לא בדקת את הרכב" : "סיימת נסיעה")
            .setContentText("ודא שכל הילדים ירדו מהרכב")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVibrate(escalated ? VIBRATION_STRONG : VIBRATION)
            .setAutoCancel(true)
            .setContentIntent(activityPI(ctx))
            .addAction(0, "בדקתי, הכל בסדר", broadcastPI(ctx, ACTION_ACK, 1))
            .addAction(0, "אין ילדים ברכב", broadcastPI(ctx, ACTION_NO_KIDS, 2));

        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            try {
                nm.notify(NOTIF_ID, b.build());
            } catch (SecurityException e) {
                // POST_NOTIFICATIONS not granted — the in-app status indicator
                // already surfaces NOTIF_PERM so the user can fix it.
            }
        }
    }

    private static void scheduleEscalation(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = broadcastPI(ctx, ACTION_ESCALATE, 3);
        long triggerAt = System.currentTimeMillis() + ESCALATE_AFTER_MS;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
                // Exact-alarm permission not granted → best-effort inexact.
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            }
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
        }
    }

    private static void cancelEscalation(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(broadcastPI(ctx, ACTION_ESCALATE, 3));
    }

    private static PendingIntent activityPI(Context ctx) {
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("carreminder://trip-check"));
        open.setPackage(ctx.getPackageName());
        return PendingIntent.getActivity(ctx, 0, open, piFlags());
    }

    private static PendingIntent broadcastPI(Context ctx, String action, int reqCode) {
        Intent i = new Intent(ctx, TripGuardActionReceiver.class).setAction(action);
        return PendingIntent.getBroadcast(ctx, reqCode, i, piFlags());
    }

    private static int piFlags() {
        return PendingIntent.FLAG_UPDATE_CURRENT
            | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
    }

    private static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel ch = new NotificationChannel(
            CHANNEL_ID, "בטיחות ילדים", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("התראה לבדוק שלא נשכח ילד ברכב בסוף נסיעה");
        ch.enableVibration(true);
        ch.setVibrationPattern(VIBRATION);
        nm.createNotificationChannel(ch);
    }

    private static int smallIcon(Context ctx) {
        int id = ctx.getResources().getIdentifier("ic_notification", "drawable", ctx.getPackageName());
        return id != 0 ? id : ctx.getApplicationInfo().icon;
    }
}
