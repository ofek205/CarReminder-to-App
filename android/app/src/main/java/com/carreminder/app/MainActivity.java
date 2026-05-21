package com.carreminder.app;

import com.getcapacitor.BridgeActivity;

// 2026-05-21 (revert): tried WindowCompat.setDecorFitsSystemWindows
// (window, true) earlier today, expecting it to put the WebView strictly
// above the system nav bar so env(safe-area-inset-bottom) would always
// be 0 and BottomNav could use a fixed padding. On the Pixel 7 API 34
// emulator that left a visible green strip between the BottomNav's
// white bg and the system nav buttons — the user wants the BottomNav
// to be flush, with the white bg extending under the system nav.
// Reverting to Capacitor's default (edge-to-edge) lets the WebView
// reach the bottom of the screen, env(safe-area-inset-bottom) reports
// the nav bar height (~126px on this emulator), and the BottomNav's
// padding-bottom picks that up to keep labels above the buttons while
// the white background flows under them — the look the user described.
public class MainActivity extends BridgeActivity {}
