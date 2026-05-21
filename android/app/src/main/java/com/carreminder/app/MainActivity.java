package com.carreminder.app;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  // 2026-05-21: forced decorFitsSystemWindows=true to make the Android
  // WebView consistently inset ABOVE the system navigation bar /
  // gesture pill across every OEM and Android version. Without this,
  // Capacitor 8's default (decorFitsSystemWindows=false) makes the
  // Activity edge-to-edge, and Chromium's CSS env(safe-area-inset-*)
  // values on Android become unreliable — reporting 0 on devices
  // where the WebView IS edge-to-edge (BottomNav hides under the
  // system nav), and reporting ~48dp on devices where it ISN'T
  // (BottomNav floats with a large white gap above the nav). Three
  // real users (videos 2026-05-20) showed both failure modes.
  //
  // With this flag set to true at Activity creation, the WebView
  // always sits above the system UI on every Android version
  // (overriding Capacitor's default). env(safe-area-inset-bottom)
  // then consistently returns 0 across devices, and the BottomNav
  // uses a fixed 4 px breathing-room padding instead of a runtime
  // value. The system nav bar is painted with android:navigationBar-
  // Color (=#FFFFFF, see styles.xml) so it visually continues the
  // app's white surface.
  //
  // Compatible with android:windowOptOutEdgeToEdgeEnforcement=true
  // in styles.xml — that flag handles Android 15+'s forced-edge-to-
  // edge mandate; this onCreate override handles Android ≤14 where
  // the flag is silently ignored. Belt + braces on both Android
  // version families.
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
  }
}
