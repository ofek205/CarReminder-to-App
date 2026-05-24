package com.carreminder.app;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Force a white window background. The launch theme's splash drawable
        // (green #16A34A) would otherwise remain as the window backdrop after
        // the splash hides (Theme.SplashScreen's postSplashScreenTheme swap
        // only fires when installSplashScreen() is called — BridgeActivity
        // does not). Plain white avoids any green/colour leakage during
        // keyboard transitions when the WebView momentarily exposes the
        // window underneath.
        getWindow().setBackgroundDrawable(new ColorDrawable(Color.WHITE));

        // No edge-to-edge override here. We rely on the standard Android
        // behaviour driven by AppTheme.NoActionBar in styles.xml:
        //   • windowOptOutEdgeToEdgeEnforcement=true → system bars are
        //     respected, in-app chrome sits in the real viewport
        //   • android:windowSoftInputMode=adjustResize (manifest) → the
        //     window/WebView physically shrinks when the keyboard opens
        //
        // The previous edge-to-edge approach (decorFitsSystemWindows(false)
        // + manual insets listener + CSS env-based padding) made the
        // WebView extend behind both the system nav bar and the keyboard.
        // When the keyboard opened the WebView did NOT shrink — Chrome
        // shrank only the CSS layout viewport, leaving a visible gap
        // between the bottom of the page content (or BottomNav) and the
        // top of the keyboard. Going back to standard Android resizing
        // eliminates that gap: the whole WebView shrinks, so anything
        // anchored at `bottom: 0` (BottomNav, sticky save buttons) sits
        // flush with the keyboard, and page content reflows naturally
        // above it.
    }
}
