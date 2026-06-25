package com.carreminder.app.tripguard;

import com.getcapacitor.JSObject;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Calendar;

/**
 * TripGuard decision logic — the Java RUNTIME twin of src/lib/tripWindow.js.
 *
 * ⚠️ PARITY: this MUST stay behaviourally identical to tripWindow.js. The JS
 * version is the model + is unit-tested (scripts/test-trip-window.cjs, 45
 * cases); this is what actually runs when the car disconnects. A shared
 * fixture-table test that exercises BOTH is a tracked follow-up — until then,
 * any change here must be mirrored there (and vice-versa).
 *
 * SAFETY-FIRST: ambiguous/malformed config errs toward "active / should alert".
 *
 * Window semantics (product decision 2026-06-23): alert if EITHER trip start
 * OR trip end is inside the active window. Duration uses the monotonic
 * elapsedRealtime clock; window checks use wall-clock local date/time.
 */
public final class TripGuardWindow {

    private TripGuardWindow() {}

    public static boolean shouldAlert(JSObject config,
                                      long tripStartWallMs, long nowWallMs,
                                      long tripStartElapsedMs, long nowElapsedMs) {
        if (config == null || !config.optBoolean("enabled", false)) return false;

        boolean endActive = isWithinActiveWindow(config, calAt(nowWallMs));
        boolean startActive = tripStartWallMs > 0 && isWithinActiveWindow(config, calAt(tripStartWallMs));
        if (!endActive && !startActive) return false;

        if (!meetsMinDuration(tripStartElapsedMs, nowElapsedMs, config.optInt("minTripMinutes", 0))) return false;
        return true;
    }

    public static boolean isWithinActiveWindow(JSObject config, Calendar date) {
        return isActiveDay(config, date) && isActiveHour(config, date) && isActiveSeason(config, date);
    }

    static boolean isActiveDay(JSObject config, Calendar date) {
        JSONArray days = config.optJSONArray("activeDays");
        if (days == null) return true;            // absent → all days
        if (days.length() == 0) return false;     // explicit empty → none
        int dow = date.get(Calendar.DAY_OF_WEEK) - 1; // Calendar SUNDAY=1 → 0=Sun (matches JS getDay)
        for (int i = 0; i < days.length(); i++) {
            if (days.optInt(i, -1) == dow) return true;
        }
        return false;
    }

    static boolean isActiveHour(JSObject config, Calendar date) {
        JSObject hours = optObject(config, "activeHours");
        if (hours == null) return true;           // null/absent → all day
        Integer start = parseHm(hours.optString("start", null));
        Integer end = parseHm(hours.optString("end", null));
        if (start == null || end == null) return true;   // malformed → fail open
        if (start.intValue() == end.intValue()) return true; // equal → all day (safety)
        int cur = date.get(Calendar.HOUR_OF_DAY) * 60 + date.get(Calendar.MINUTE);
        if (start < end) return cur >= start && cur < end;   // end exclusive
        return cur >= start || cur < end;                    // overnight wrap
    }

    static boolean isActiveSeason(JSObject config, Calendar date) {
        JSObject season = optObject(config, "activeSeason");
        if (season == null) return true;
        if (!season.has("startMonth") || !season.has("endMonth")) return true;
        int start = season.optInt("startMonth", -1);
        int end = season.optInt("endMonth", -1);
        if (start < 1 || start > 12 || end < 1 || end > 12) return true; // malformed → fail open
        int month = date.get(Calendar.MONTH) + 1; // Calendar months 0-based → 1-12
        if (start <= end) return month >= start && month <= end;
        return month >= start || month <= end;     // wraparound (e.g. Nov–Feb)
    }

    static boolean meetsMinDuration(long startElapsedMs, long nowElapsedMs, int minMinutes) {
        if (startElapsedMs <= 0) return true;      // unknown start → alert (safety)
        long elapsed = nowElapsedMs - startElapsedMs;
        if (elapsed < 0) return true;              // monotonic clock makes this unreachable
        int min = Math.max(0, minMinutes);
        return elapsed >= (long) min * 60L * 1000L;
    }

    // ── helpers ──

    private static Calendar calAt(long wallMs) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(wallMs);
        return c;
    }

    private static Integer parseHm(String s) {
        if (s == null) return null;
        String[] parts = s.split(":");
        if (parts.length != 2) return null;
        try {
            int h = Integer.parseInt(parts[0].trim());
            int m = Integer.parseInt(parts[1].trim());
            if (h < 0 || h > 23 || m < 0 || m > 59) return null;
            return h * 60 + m;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** Read a nested object as a JSObject, or null if absent/JSON-null/not an object. */
    private static JSObject optObject(JSObject config, String key) {
        if (!config.has(key) || config.isNull(key)) return null;
        JSONObject o = config.optJSONObject(key);
        if (o == null) return null;
        try {
            return JSObject.fromJSONObject(o);
        } catch (JSONException e) {
            return null;
        }
    }
}
