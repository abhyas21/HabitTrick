import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.habittrick.app',
  appName: 'Habit Trick',
  webDir: 'dist',
  android: {
    // Keep the native WebView origin secure for Supabase and browser APIs.
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      launchFadeOutDuration: 200,
      backgroundColor: '#f8faf9',
      showSpinner: false
    }
  }
};

export default config;
