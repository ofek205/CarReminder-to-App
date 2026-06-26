package com.carreminder.app.tripguard;

import static org.junit.Assert.assertEquals;

import com.getcapacitor.JSObject;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.junit.Test;

import java.io.InputStream;
import java.util.Calendar;
import java.util.Scanner;

/**
 * Parity test: TripGuardWindow.java MUST behave identically to
 * src/lib/tripWindow.js. Both read the SAME fixtures
 * (src/test/resources/tripwindow-fixtures.json), which the JS smoke test
 * (scripts/test-trip-window.cjs) also runs against. If one side drifts, one
 * of the two test suites goes red.
 *
 * Run: ./gradlew :app:testDebugUnitTest
 *
 * NOTE: this is a LOCAL JVM unit test. Android's bundled org.json is stubbed
 * ("Stub!") in local unit tests, so build.gradle adds a real
 * `testImplementation "org.json:json:..."` to make JSObject (which extends
 * org.json.JSONObject) work here.
 */
public class TripGuardWindowTest {

    @Test
    public void windowParity() throws JSONException {
        JSONArray cases = loadFixtures().getJSONArray("window");
        for (int i = 0; i < cases.length(); i++) {
            JSONObject f = cases.getJSONObject(i);
            JSObject config = JSObject.fromJSONObject(f.getJSONObject("config"));
            Calendar cal = Calendar.getInstance();
            cal.clear();
            cal.set(f.getInt("y"), f.getInt("mo") - 1, f.getInt("d"), f.getInt("h"), f.getInt("mi"), 0);
            assertEquals(
                "window: " + f.getString("name"),
                f.getBoolean("expected"),
                TripGuardWindow.isWithinActiveWindow(config, cal)
            );
        }
    }

    @Test
    public void durationParity() throws JSONException {
        JSONArray cases = loadFixtures().getJSONArray("duration");
        for (int i = 0; i < cases.length(); i++) {
            JSONObject f = cases.getJSONObject(i);
            assertEquals(
                "duration: " + f.getString("name"),
                f.getBoolean("expected"),
                TripGuardWindow.meetsMinDuration(
                    f.getLong("startElapsed"), f.getLong("nowElapsed"), f.getInt("minMinutes"))
            );
        }
    }

    private JSONObject loadFixtures() throws JSONException {
        InputStream in = getClass().getClassLoader().getResourceAsStream("tripwindow-fixtures.json");
        if (in == null) {
            throw new IllegalStateException("tripwindow-fixtures.json not found on the test classpath");
        }
        Scanner scanner = new Scanner(in, "UTF-8").useDelimiter("\\A");
        String json = scanner.hasNext() ? scanner.next() : "";
        scanner.close();
        return new JSONObject(json);
    }
}
