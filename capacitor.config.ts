import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.claritynotes.mobile",
  appName: "Clarity Notes",
  webDir: "dist",
  server: {
    androidScheme: "https",
    iosScheme: "capacitor",
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: "#faf6f0",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#faf6f0",
    },
  },
  ios: {
    contentInset: "automatic",
    preferredContentMode: "mobile",
  },
  android: {
    backgroundColor: "#faf6f0",
  },
};

export default config;
