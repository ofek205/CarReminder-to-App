import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Bundle ID note: iOS native (pbxproj) and the Apple App Store record
  // are 'com.carreminders.app' (plural). Android applicationId overrides
  // this in android/app/build.gradle to 'com.carreminder.app' (singular)
  // because the Google Play record was registered without the 's'. The
  // Capacitor appId here mirrors the iOS bundle ID to avoid runtime
  // mismatches between Capacitor's bridged appId and the actual bundle.
  appId: 'com.carreminders.app',
  appName: 'CarReminder',
  webDir: 'dist',
  // Allow loading from Supabase and external APIs
  server: {
    androidScheme: 'https',
    // Allow mixed content for dev
    allowNavigation: [
      'zuqvolqapwcxomuzoodu.supabase.co',
      'data.gov.il',
      'api.anthropic.com',
      'images.pexels.com',
      '*.tile.openstreetmap.org',
      'overpass-api.de',
      'car-reminder.app',
      'www.car-reminder.app',
    ],
  },
  plugins: {
    // Splash strategy:
    //   launchAutoHide=false  → native splash stays up until JS calls
    //                            SplashScreen.hide() AFTER React mounts.
    //   launchShowDuration=5000 → safety ceiling. With autoHide=false this
    //                            is effectively a no-op, but kept as a
    //                            documentation hint that 5s is the longest
    //                            we'd ever expect cold start to take.
    // Why this matters: on a fresh install on a new iOS device (App Review
    // scenario) the bundle parse + AuthPage lazy-load + Supabase init can
    // exceed 2s. With the previous launchAutoHide=true the splash dropped
    // before React painted, and the user saw a white screen — exactly what
    // Apple QA flagged as "blank screen on launch" (Guideline 2.1(a)).
    SplashScreen: {
      launchShowDuration: 5000,
      launchAutoHide: false,
      backgroundColor: '#16A34A',
      showSpinner: true,
      spinnerColor: '#FFFFFF',
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#2D5233',
      overlaysWebView: false,
    },
    Keyboard: {
      resize: 'none',
      resizeOnFullScreen: false,
    },
    LocalNotifications: {
      smallIcon: 'ic_notification',
      iconColor: '#16A34A',
      sound: 'default',
    },
  },
};

export default config;
