import { isNativeApp } from "./native";

const DEFAULT_NATIVE_API = "https://clarity-notes-production.up.railway.app";

/**
 * Resolve a relative /_api path against the hosted backend when the UI
 * is running inside Capacitor (file/localhost origin) instead of Railway.
 */
export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const configured = String(import.meta.env.VITE_API_BASE_URL ?? "").replace(
    /\/$/,
    "",
  );
  const base = configured || (isNativeApp() ? DEFAULT_NATIVE_API : "");
  if (!base) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
