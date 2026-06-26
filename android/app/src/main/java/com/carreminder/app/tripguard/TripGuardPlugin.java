package com.carreminder.app.tripguard;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import org.json.JSONException;

import java.util.Set;

/**
 * TripGuard — native Android plugin for the child-in-car safety reminder.
 *
 * SCOPE (P2): config storage, real status (Bluetooth adapter / permissions /
 * battery optimisation), real paired-device listing, and permission requests
 * (the latter auto-provided by Capacitor from the @Permission annotations —
 * checkPermissions()/requestPermissions() are NOT implemented here on purpose).
 *
 * NOT YET (P3): the BroadcastReceiver for ACL_CONNECTED/DISCONNECTED + the
 * vibrating notification. That is the actual background detection and is
 * added next.
 *
 * Reason codes below MUST stay in sync with TRIP_GUARD_REASONS in
 * src/lib/tripGuard/definitions.js.
 */
@CapacitorPlugin(
    name = "TripGuard",
    permissions = {
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class TripGuardPlugin extends Plugin {

    private static final String R_DISABLED = "DISABLED";
    private static final String R_NO_DEVICE = "NO_DEVICE";
    private static final String R_BT_OFF = "BT_OFF";
    private static final String R_BT_PERM = "BT_PERM";
    private static final String R_NOTIF_PERM = "NOTIF_PERM";
    // NOTE: there is no R_BATTERY in `reasons`. Battery optimisation is
    // ADVISORY, not a blocker: we use a manifest BroadcastReceiver for the
    // car's ACL connect/disconnect, and those system broadcasts are exempt
    // from background limits (they fire under Doze). `batteryOptimized` is
    // still reported as a field so the UI can show a soft reliability hint.

    @PluginMethod
    public void getConfig(PluginCall call) {
        call.resolve(TripGuardStore.getConfig(getContext()));
    }

    @PluginMethod
    public void saveConfig(PluginCall call) {
        TripGuardStore.saveConfig(getContext(), call.getData());
        call.resolve();
    }

    @PluginMethod
    public void enable(PluginCall call) {
        TripGuardStore.setEnabled(getContext(), true);
        call.resolve();
    }

    @PluginMethod
    public void disable(PluginCall call) {
        TripGuardStore.setEnabled(getContext(), false);
        call.resolve();
    }

    @PluginMethod
    public void snoozeOnce(PluginCall call) {
        TripGuardStore.setSnoozeNextTrip(getContext(), true);
        JSObject ret = new JSObject();
        ret.put("snoozed", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void listPairedDevices(PluginCall call) {
        JSObject ret = new JSObject();
        JSArray devices = new JSArray();
        if (hasBluetoothPermission()) {
            BluetoothAdapter adapter = getAdapter();
            if (adapter != null) {
                try {
                    Set<BluetoothDevice> bonded = adapter.getBondedDevices();
                    if (bonded != null) {
                        for (BluetoothDevice d : bonded) {
                            JSObject o = new JSObject();
                            o.put("id", d.getAddress());
                            String name = d.getName();
                            o.put("name", name != null ? name : d.getAddress());
                            devices.put(o);
                        }
                    }
                } catch (SecurityException e) {
                    // Permission revoked between the check and the call — return
                    // whatever we managed to collect rather than crashing.
                }
            }
        }
        ret.put("devices", devices);
        call.resolve(ret);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject config = TripGuardStore.getConfig(getContext());
        boolean enabled = config.optBoolean("enabled", false);

        int deviceCount = 0;
        try {
            if (config.has("carDeviceIds")) {
                deviceCount = config.getJSONArray("carDeviceIds").length();
            }
        } catch (JSONException ignored) {
            // malformed config — treat as no devices selected
        }

        BluetoothAdapter adapter = getAdapter();
        boolean btOn = adapter != null && adapter.isEnabled();
        boolean btPerm = hasBluetoothPermission();
        boolean notifPerm = hasNotificationPermission();
        boolean batteryOptimized = isBatteryOptimized();

        JSArray reasons = new JSArray();
        if (!enabled) reasons.put(R_DISABLED);
        if (deviceCount == 0) reasons.put(R_NO_DEVICE);
        if (!btOn) reasons.put(R_BT_OFF);
        if (!btPerm) reasons.put(R_BT_PERM);
        if (!notifPerm) reasons.put(R_NOTIF_PERM);
        // batteryOptimized is intentionally NOT a reason (advisory only).

        JSObject ret = new JSObject();
        ret.put("ready", reasons.length() == 0);
        ret.put("reasons", reasons);
        ret.put("btAdapterOn", btOn);
        ret.put("btPermission", btPerm ? "granted" : "denied");
        ret.put("notifPermission", notifPerm ? "granted" : "denied");
        ret.put("batteryOptimized", batteryOptimized);
        call.resolve(ret);
    }

    @PluginMethod
    public void getTripLog(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("entries", TripGuardStore.getTripLog(getContext()));
        call.resolve(ret);
    }

    /**
     * Opens the system battery-optimisation settings so the user can exempt
     * the app (improves background reliability). Uses the SETTINGS action,
     * which — unlike ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS — needs NO
     * special permission (the latter is the one Google Play rejects for this
     * app category). Falls back to the app details page.
     */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Context ctx = getContext();
        try {
            Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
        } catch (Exception e) {
            try {
                Intent i = new Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + ctx.getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
            } catch (Exception ignored) {
                // nothing we can open — the advisory hint stays as-is
            }
        }
        call.resolve();
    }

    // ── helpers ──

    private BluetoothAdapter getAdapter() {
        BluetoothManager bm = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return bm != null ? bm.getAdapter() : null;
    }

    /** BLUETOOTH_CONNECT is a runtime permission only on Android 12 (S)+. */
    private boolean hasBluetoothPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_CONNECT)
            == PackageManager.PERMISSION_GRANTED;
    }

    /** POST_NOTIFICATIONS is a runtime permission only on Android 13 (TIRAMISU)+. */
    private boolean hasNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true;
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED;
    }

    /** True when Doze battery optimisation could throttle our background work. */
    private boolean isBatteryOptimized() {
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        if (pm == null) return false;
        return !pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }
}
