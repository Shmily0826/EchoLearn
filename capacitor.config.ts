import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'uk.echolearn.app',
  appName: 'EchoLearn',
  webDir: 'dist',

  server: {
    url: 'https://app.echo-learn.uk',
    allowNavigation: [
      'app.echo-learn.uk',
      'echolearn-9f369.firebaseapp.com',
      'accounts.google.com',
      'www.youtube.com',
      'youtube.com',
      'player.bilibili.com',
      'bilibili.com',
    ],
    cleartext: false,
  },

  plugins: {
    FirebaseAuthentication: {
      skipNativeAuth: false,
      providers: ['google.com'],
    },
    SplashScreen: {
      launchShowDuration: 3000,
      launchAutoHide: true,
      backgroundColor: '#863bff',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#863bff',
    },
  },

  android: {
    allowMixedContent: true,
    backgroundColor: '#863bff',
  },
};

export default config;
