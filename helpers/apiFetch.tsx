/**
 * fetch wrapper that attaches the Clerk session token to API requests.
 * The token getter is registered by the AuthProvider (which lives inside
 * ClerkProvider), so endpoint schema helpers can stay auth-agnostic.
 * Client only.
 */

import { resolveApiUrl } from "./apiBase";

let tokenGetter: (() => Promise<string | null>) | null = null;

export function registerTokenGetter(getter: () => Promise<string | null>) {
  tokenGetter = getter;
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
      // If the token can't be fetched, send the request unauthenticated —
      // the server will answer 401 and the UI will react accordingly.
    }
  }
  const url = typeof input === "string" ? resolveApiUrl(input) : input;
  return fetch(url, { ...init, headers });
}
