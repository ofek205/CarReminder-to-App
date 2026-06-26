package com.carreminder.app.tripguard;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Handles taps on the safety-alert notification's action buttons, and the
 * escalation alarm. Internal only (exported=false) — every PendingIntent that
 * targets it is created inside the app.
 *
 *   ACK / NO_KIDS → user responded → clear the alert + cancel escalation
 *   ESCALATE      → 30s passed with no response → re-fire (stronger)
 */
public class TripGuardActionReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;

        switch (action) {
            case TripGuardNotifier.ACTION_ACK:
            case TripGuardNotifier.ACTION_NO_KIDS:
                TripGuardNotifier.cancelAlert(context);
                break;
            case TripGuardNotifier.ACTION_ESCALATE:
                TripGuardNotifier.fireEscalated(context);
                break;
            default:
                break;
        }
    }
}
