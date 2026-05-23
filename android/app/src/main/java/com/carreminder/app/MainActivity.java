package com.carreminder.app;

import android.graphics.Color;
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
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            boolean kb = insets.isVisible(WindowInsetsCompat.Type.ime());

            v.setPadding(bars.left, bars.top, bars.right, kb ? ime.bottom : 0);

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
