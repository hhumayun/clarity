const DEFAULT_API = "https://clarity-notes-production.up.railway.app";

let tokenGetter: (() => Promise<string | null>) | null = null;

export function registerTokenGetter(getter: () => Promise<string | null>) {
  tokenGetter = getter;
}

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const configured = String(
    process.env.EXPO_PUBLIC_API_BASE_URL ?? DEFAULT_API,
  ).replace(/\/$/, "");
  return `${configured}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function apiFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (tokenGetter) {
    try {
      const token = await tokenGetter();
      if (token) headers.set("Authorization", `Bearer ${token}`);
    } catch {
      // Send unauthenticated; the server will answer 401.
    }
  }
  const url = typeof input === "string" ? resolveApiUrl(input) : input;
  return fetch(url, { ...init, headers });
}
