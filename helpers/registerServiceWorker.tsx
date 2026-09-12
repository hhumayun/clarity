/**
 * Register the PWA service worker in production builds only.
 * Dev servers (Vite HMR) should never be intercepted.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD) return;
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // An installable app is a nicety; a failed worker should not block writing.
    });
  });
}
