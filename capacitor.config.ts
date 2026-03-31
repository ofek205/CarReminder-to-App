import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.carreminders.app',
  appName: 'CarReminders',
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
      backgroundColor: '#16A34A',
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
