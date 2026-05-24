package com.carreminder.app;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // ── Force a WHITE window background ──────────────────────────
        // The launch theme (AppTheme.NoActionBarLaunch) sets the window
        // background to @drawable/splash (a solid green #16A34A used as
        // the splash backdrop). Theme.SplashScreen's postSplashScreenTheme
        // is supposed to swap the theme to AppTheme.NoActionBar (white
        // windowBackground) after the splash hides, but that swap only
        // fires if installSplashScreen() is called explicitly — which
        // Capacitor's BridgeActivity does not do. Without the swap, the
        // green splash drawable stays as the window background forever,
        // visible whenever the WebView shrinks (e.g. keyboard open) and
        // exposes the area beneath it. Override directly with a white
        // ColorDrawable so the keyboard reveal shows a benign white
        // surface instead of a startling green stripe.
        getWindow().setBackgroundDrawable(new ColorDrawable(Color.WHITE));

        // ── Edge-to-edge: let the WebView extend behind the nav bar ──
        // With the default decorFitsSystemWindows=true the framework adds
        // bottom padding on the DecorView equal to the nav-bar height.
        // That pushes the entire WebView UP, creating a gap between the
        // BottomNav (CSS bottom:0) and the system navigation buttons.
        // Switching to false removes the framework padding; we manage
        // insets ourselves on the WebView parent.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // Keep bars opaque so they don't show page content behind them
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        getWindow().setNavigationBarColor(Color.WHITE);
        getWindow().setStatusBarColor(0xFF2D5233);
        WindowInsetsControllerCompat ctrl =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (ctrl != null) {
            ctrl.setAppearanceLightStatusBars(false);
            ctrl.setAppearanceLightNavigationBars(true);
        }

        // ── Insets listener on WebView parent ────────────────────────
        // Top padding = status bar + cutout  → content below status bar
        // Bottom padding = 0 (keyboard: IME) → WebView reaches nav bar
        // The nav-bar height is injected as a CSS variable so the
        // BottomNav component can pad its content above the buttons
        // while its white background extends behind them.
        View parent = (View) getBridge().getWebView().getParent();
        parent.setBackgroundColor(Color.WHITE);

        ViewCompat.setOnApplyWindowInsetsListener(parent, (v, insets) -> {
            Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout()
            );

            // Bottom padding is always 0: the system nav bar is handled by
            // CSS env(safe-area-inset-bottom) and the keyboard resize is
            // handled by Chrome's interactive-widget=resizes-content (set in
            // the viewport meta tag). Previously ime.bottom was added here
            // when the keyboard was visible, but that DOUBLE-shrinks the
            // content area (Java padding + Chrome viewport resize) and
            // pushes everything off-screen → white screen on input focus.
            v.setPadding(bars.left, bars.top, bars.right, 0);

            // Tell CSS exactly how tall the nav bar is
            float density = getResources().getDisplayMetrics().density;
            int navDp = Math.round(bars.bottom / density);
            getBridge().getWebView().evaluateJavascript(
                "document.documentElement.style.setProperty('--cap-nav-bar-height','"
                    + navDp + "px')",
                null
            );

            return new WindowInsetsCompat.Builder(insets)
                .setInsets(
                    WindowInsetsCompat.Type.systemBars()
                        | WindowInsetsCompat.Type.displayCutout(),
                    Insets.of(0, 0, 0, 0)
                )
                .build();
        });
        parent.requestApplyInsets();
    }
}
