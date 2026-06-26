package com.carreminder.app.tripguard;

import android.bluetooth.BluetoothDevice;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;

import com.getcapacitor.JSObject;

import org.json.JSONArray;

/**
 * The heart of TripGuard: listens (via manifest registration) for the car's
 * Bluetooth connect/disconnect and decides whether to fire the safety alert.
 *
 * Why a manifest receiver (not a foreground service): ACL_CONNECTED /
 * ACL_DISCONNECTED are exempt from Android's implicit-broadcast restrictions,
 * so this fires even when the app is killed — without a persistent service or
 * a battery-optimisation exemption. onReceive does only quick work (read
 * prefs, decide, post a notification), well within the receiver time budget,
 * so no FGS is needed at fire time.
 *
 *   CONNECTED    → record trip start (wall + monotonic clocks)
 *   DISCONNECTED → if the trip meets the rules, fire the alert
 */
public class TripGuardReceiver extends BroadcastReceiver {

    /** Ignore connect/disconnect flapping shorter than this (brief BT dropout). */
    private static final long DEBOUNCE_MS = 5000L;

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;

        @SuppressWarnings("deprecation")
        BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
        if (device == null) return;
        String address;
        try {
            address = device.getAddress();
        } catch (SecurityException e) {
            return; // no BLUETOOTH_CONNECT — can't identify the device
        }
        if (address == null) return;

        JSObject config = TripGuardStore.getConfig(context);
        if (!config.optBoolean("enabled", false)) return;
        if (!isCarDevice(config, address)) return;

        long nowWall = System.currentTimeMillis();
        long nowElapsed = SystemClock.elapsedRealtime();

        if (BluetoothDevice.ACTION_ACL_CONNECTED.equals(action)) {
            // Debounce: if we disconnected just moments ago and a trip is
            // already in progress, treat this as a brief dropout — keep the
            // original start time instead of resetting it.
            long lastDisc = TripGuardStore.getLastDisconnectElapsed(context);
            boolean tripInProgress = TripGuardStore.getTripStartElapsed(context) > 0;
            if (tripInProgress && lastDisc > 0 && (nowElapsed - lastDisc) < DEBOUNCE_MS) {
                return;
            }
            TripGuardStore.setTripStart(context, nowWall, nowElapsed);
            return;
        }

        if (BluetoothDevice.ACTION_ACL_DISCONNECTED.equals(action)) {
            TripGuardStore.setLastDisconnectElapsed(context, nowElapsed);

            long startWall = TripGuardStore.getTripStartWall(context);
            long startElapsed = TripGuardStore.getTripStartElapsed(context);

            // Consume one-shot snooze and clear the trip regardless of outcome,
            // so the next trip starts clean.
            boolean snoozed = TripGuardStore.isSnoozeNextTrip(context);
            TripGuardStore.setSnoozeNextTrip(context, false);
            TripGuardStore.clearTripStart(context);

            boolean willAlert = !snoozed
                && TripGuardWindow.shouldAlert(config, startWall, nowWall, startElapsed, nowElapsed);

            // Log every detected trip end (for the in-app transparency log),
            // recording whether it fired an alert.
            TripGuardStore.appendTripLog(context, nowWall, willAlert);

            if (willAlert) {
                TripGuardNotifier.fireCheckCarAlert(context);
            }
        }
    }

    private boolean isCarDevice(JSObject config, String address) {
        JSONArray ids = config.optJSONArray("carDeviceIds");
        if (ids == null) return false;
        for (int i = 0; i < ids.length(); i++) {
            if (address.equalsIgnoreCase(ids.optString(i, ""))) return true;
        }
        return false;
    }
}
