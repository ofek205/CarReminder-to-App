package com.carreminder.app.tripguard;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * TripGuard config store — the SINGLE SOURCE OF TRUTH at runtime.
 *
 * Why native (not JS / Capacitor Preferences read from JS): the WebView is
 * dead when the car disconnects, which is exactly when the BroadcastReceiver
 * (P3) needs to read the config to decide whether to alert. So the receiver
 * reads straight from these SharedPreferences — no JS involved.
 *
 * The JS layer (SafetyReminder screen) writes here via TripGuardPlugin.
 * Config shape mirrors TripGuardConfig in src/lib/tripGuard/definitions.js.
 */
public final class TripGuardStore {
    private static final String PREFS = "tripguard";
    private static final String KEY_CONFIG = "config";
    private static final String KEY_SNOOZE = "snoozeNextTrip";
    // Trip timing. Wall clock drives the active-window check (local date/time);
    // the monotonic elapsedRealtime clock drives the duration check so a
    // mid-trip system-clock change can't shorten/lengthen a trip (QA F12).
    private static final String KEY_TRIP_START_WALL = "tripStartWall";
    private static final String KEY_TRIP_START_ELAPSED = "tripStartElapsed";
    private static final String KEY_LAST_DISCONNECT_ELAPSED = "lastDisconnectElapsed";
    private static final String KEY_LOG = "tripLog";
    private static final int LOG_MAX = 10;

    private TripGuardStore() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static JSObject getConfig(Context ctx) {
        String raw = prefs(ctx).getString(KEY_CONFIG, null);
        if (raw == null) return defaults();
        try {
            return new JSObject(raw);
        } catch (JSONException e) {
            return defaults();
        }
    }

    public static void saveConfig(Context ctx, JSObject config) {
        if (config == null) return;
        prefs(ctx).edit().putString(KEY_CONFIG, config.toString()).apply();
    }

    public static void setEnabled(Context ctx, boolean enabled) {
        JSObject c = getConfig(ctx);
        c.put("enabled", enabled);
        saveConfig(ctx, c);
    }

    public static void setSnoozeNextTrip(Context ctx, boolean snooze) {
        prefs(ctx).edit().putBoolean(KEY_SNOOZE, snooze).apply();
    }

    public static boolean isSnoozeNextTrip(Context ctx) {
        return prefs(ctx).getBoolean(KEY_SNOOZE, false);
    }

    // ── Trip timing (written by TripGuardReceiver) ──

    public static void setTripStart(Context ctx, long wallMs, long elapsedMs) {
        prefs(ctx).edit()
            .putLong(KEY_TRIP_START_WALL, wallMs)
            .putLong(KEY_TRIP_START_ELAPSED, elapsedMs)
            .apply();
    }

    public static long getTripStartWall(Context ctx) {
        return prefs(ctx).getLong(KEY_TRIP_START_WALL, 0L);
    }

    public static long getTripStartElapsed(Context ctx) {
        return prefs(ctx).getLong(KEY_TRIP_START_ELAPSED, 0L);
    }

    public static void clearTripStart(Context ctx) {
        prefs(ctx).edit()
            .remove(KEY_TRIP_START_WALL)
            .remove(KEY_TRIP_START_ELAPSED)
            .apply();
    }

    public static void setLastDisconnectElapsed(Context ctx, long elapsedMs) {
        prefs(ctx).edit().putLong(KEY_LAST_DISCONNECT_ELAPSED, elapsedMs).apply();
    }

    public static long getLastDisconnectElapsed(Context ctx) {
        return prefs(ctx).getLong(KEY_LAST_DISCONNECT_ELAPSED, 0L);
    }

    // ── Trip log (transparency: shows the user that detection is working) ──

    public static void appendTripLog(Context ctx, long endWallMs, boolean alerted) {
        try {
            String raw = prefs(ctx).getString(KEY_LOG, null);
            JSONArray arr = raw != null ? new JSONArray(raw) : new JSONArray();
            JSONObject entry = new JSONObject();
            entry.put("at", endWallMs);
            entry.put("alerted", alerted);
            arr.put(entry);
            // Keep only the most recent LOG_MAX entries.
            while (arr.length() > LOG_MAX) arr.remove(0);
            prefs(ctx).edit().putString(KEY_LOG, arr.toString()).apply();
        } catch (JSONException ignored) {
            // never let logging break the safety path
        }
    }

    /** Newest-first list of recent detected trip ends. */
    public static JSONArray getTripLog(Context ctx) {
        String raw = prefs(ctx).getString(KEY_LOG, null);
        if (raw == null) return new JSONArray();
        try {
            JSONArray stored = new JSONArray(raw);
            JSONArray reversed = new JSONArray();
            for (int i = stored.length() - 1; i >= 0; i--) {
                reversed.put(stored.get(i));
            }
            return reversed;
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    /**
     * Safety-first defaults — widest active window. `activeHours`/`activeSeason`
     * are intentionally OMITTED (absent == "all the time"), matching the
     * null-means-all semantics in tripWindow.js.
     */
    private static JSObject defaults() {
        JSObject c = new JSObject();
        c.put("enabled", false);
        c.put("carDeviceIds", new JSArray());
        JSArray days = new JSArray();
        for (int i = 0; i <= 6; i++) days.put(i);
        c.put("activeDays", days);
        c.put("minTripMinutes", 2);
        c.put("alertDelaySeconds", 0);
        c.put("escalateAfterSeconds", 30);
        return c;
    }
}
