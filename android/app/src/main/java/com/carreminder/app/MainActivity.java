package com.carreminder.app;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsAnimationCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import java.util.List;

/**
 * Edge-to-edge layout, single source of truth for insets.
 *
 * Why edge-to-edge: on Android 16+ (target SDK 36 in this project) the
 * framework forces edge-to-edge regardless of windowOptOutEdgeToEdgeEnforcement
 * — that flag is a no-op on API 36. Rather than fight the framework, we
 * commit fully to edge-to-edge and pipe the real inset values into CSS so
 * the React layout reflows correctly for status bar, gesture nav bar, and
 * IME (keyboard).
 *
 * Why setBackgroundDrawable(WHITE): BridgeActivity does NOT call
 * SplashScreen.installSplashScreen(), so Theme.SplashScreen's
 * postSplashScreenTheme swap never fires. The launch theme's green splash
 * drawable would otherwise remain as the window backdrop indefinitely.
 * Explicitly painting the window white in onCreate is the only protection
 * against that drawable showing through the keyboard / system bar regions.
 * DO NOT remove this line without also calling installSplashScreen().
 *
 * Why we don't return WindowInsetsCompat.CONSUMED: Capacitor's Keyboard
 * plugin (and any future view-tree consumer) needs the insets too. We
 * read them in our listener and inject CSS vars, but pass them through
 * unchanged so other consumers keep working.
 */
public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Belt-and-suspenders white window background.
        // See class javadoc for why this is mandatory.
        getWindow().setBackgroundDrawable(new ColorDrawable(Color.WHITE));

        // Commit to edge-to-edge explicitly across all Android versions
        // (API 30-35: opt-in here; API 36+: framework-forced anyway).
        // Single code path = less surface for OEM divergence.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // Guard against bridge/WebView not being ready yet on some
        // BridgeActivity init paths. The view tree must exist before
        // we attach listeners.
        View target = getBridge() != null && getBridge().getWebView() != null
            ? getBridge().getWebView()
            : findViewById(android.R.id.content);
        if (target == null) return;

        // Paint the WebView itself white so even a one-frame paint miss
        // during keyboard transitions shows white, not the splash green
        // peeking through a transparent surface.
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(Color.WHITE);
        }

        final float density = getResources().getDisplayMetrics().density;

        // Per-event listener: fires on attach + every steady-state inset
        // change (rotation, gesture-bar reveal, etc.). We do NOT consume
        // (return original insets) so Capacitor plugins still work.
        ViewCompat.setOnApplyWindowInsetsListener(target, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            Insets ime  = insets.getInsets(WindowInsetsCompat.Type.ime());
            boolean imeVisible = insets.isVisible(WindowInsetsCompat.Type.ime());

            int topDp    = Math.round(bars.top / density);
            // ime.bottom already includes the gesture-bar region on AOSP/
            // Samsung/OnePlus (modern). On legacy MIUI 13 ime.bottom may
            // exclude it — max() picks the right value either way for the
            // common case, accepting a small (~24dp) under-pad on those
            // legacy devices.
            int bottomDp = Math.round(Math.max(bars.bottom, ime.bottom) / density);
            int leftDp   = Math.round(bars.left / density);
            int rightDp  = Math.round(bars.right / density);

            pushInsetsToCss(topDp, bottomDp, leftDp, rightDp, imeVisible);

            // Return ORIGINAL insets — do NOT consume. Capacitor's
            // Keyboard plugin and any other view-tree listeners need to
            // see these too.
            return insets;
        });

        // Per-frame listener for smooth IME animations. Without this the
        // BottomNav snaps at animation end instead of riding the keyboard
        // up/down. DISPATCH_MODE_CONTINUE_ON_SUBTREE lets the regular
        // listener also fire (we want both: per-frame during animation,
        // final value via onApplyWindowInsetsListener at end).
        WindowInsetsAnimationCompat.Callback animCallback =
            new WindowInsetsAnimationCompat.Callback(
                WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE
            ) {
                @Override
                public WindowInsetsCompat onProgress(
                    WindowInsetsCompat insets,
                    List<WindowInsetsAnimationCompat> runningAnimations
                ) {
                    Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
                    Insets ime  = insets.getInsets(WindowInsetsCompat.Type.ime());
                    int bottomDp = Math.round(Math.max(bars.bottom, ime.bottom) / density);
                    int topDp    = Math.round(bars.top / density);
                    int leftDp   = Math.round(bars.left / density);
                    int rightDp  = Math.round(bars.right / density);
                    boolean imeVisible = ime.bottom > 0;
                    pushInsetsToCss(topDp, bottomDp, leftDp, rightDp, imeVisible);
                    return insets;
                }
            };
        ViewCompat.setWindowInsetsAnimationCallback(target, animCallback);

        // Force first dispatch in case the view is already attached.
        target.requestApplyInsets();
    }

    /**
     * Push the current inset values to CSS via a single evaluateJavascript
     * call. Kept tight on purpose (no DOM queries, no event dispatches in
     * the hot path) so per-frame calls during IME animation stay cheap on
     * budget devices.
     */
    private void pushInsetsToCss(int topDp, int bottomDp, int leftDp, int rightDp, boolean imeVisible) {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        String js =
            "(function(){var d=document.documentElement.style;" +
            "d.setProperty('--android-inset-top','"    + topDp    + "px');" +
            "d.setProperty('--android-inset-bottom','" + bottomDp + "px');" +
            "d.setProperty('--android-inset-left','"   + leftDp   + "px');" +
            "d.setProperty('--android-inset-right','"  + rightDp  + "px');" +
            "document.body&&document.body.classList.toggle('keyboard-visible'," + imeVisible + ");" +
            "})();";
        getBridge().getWebView().evaluateJavascript(js, null);
    }
}
