import superjson from "superjson";
import { apiFetch } from "./apiFetch";
import { jsonHeaders } from "./parse";
import type { User } from "../types";

export type SessionOutput = { user: User } | { error: string };

export async function getSession(init?: RequestInit): Promise<SessionOutput> {
  const result = await apiFetch("/_api/auth/session", {
    method: "GET",
    ...init,
    headers: jsonHeaders(init),
  });
  return superjson.parse<SessionOutput>(await result.text());
}
