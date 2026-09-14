import { Capacitor } from "@capacitor/core";

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

export async function initNativeShell(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  document.documentElement.classList.add("native-app");

  const [
    { StatusBar },
    { SplashScreen },
    { Keyboard, KeyboardResize },
    { App },
  ] = await Promise.all([
    import("@capacitor/status-bar"),
    import("@capacitor/splash-screen"),
    import("@capacitor/keyboard"),
    import("@capacitor/app"),
  ]);

  try {
    await StatusBar.setOverlaysWebView({ overlay: true });
  } catch {
    // Older Android builds may not support overlaying the webview.
  }

  await syncNativeStatusBar();

  try {
    await Keyboard.setResizeMode({ mode: KeyboardResize.Body });
  } catch {
    // Resize mode is not available on every platform version.
  }

  void App.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack || window.history.length > 1) {
      window.history.back();
      return;
    }
    void App.exitApp();
  });

  await SplashScreen.hide();
}

export async function syncNativeStatusBar(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const { StatusBar, Style } = await import("@capacitor/status-bar");
  const dark = document.body.classList.contains("dark");

  try {
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({
      color: dark ? "#1e1c19" : "#faf6f0",
    });
  } catch {
    // Web preview and some emulators do not implement these calls.
  }
}
