import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
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
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
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
