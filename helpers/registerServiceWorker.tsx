/**
 * Register the PWA service worker in production builds only.
 * Dev servers (Vite HMR) should never be intercepted.
 */
import { isNativeApp } from "./native";

export function registerServiceWorker() {
  if (!import.meta.env.PROD) return;
  if (isNativeApp()) return;
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // An installable app is a nicety; a failed worker should not block writing.
    });
  });
}
