import superjson from "superjson";
import { apiFetch } from "./apiFetch";
import { jsonHeaders, parseResponse } from "./parse";
import type { EntityType, NoteRecord, ProjectRecord, TaskRecord } from "../types";

export async function getPreferences(
  init?: RequestInit,
): Promise<{ usePersonalization: boolean }> {
  const result = await apiFetch("/_api/preferences", { method: "GET", ...init });
  return parseResponse(result);
}

export async function postPreferences(
  body: { usePersonalization: boolean },
  init?: RequestInit,
): Promise<{ usePersonalization: boolean }> {
  const result = await apiFetch("/_api/preferences", {
    method: "POST",
    body: superjson.stringify(body),
    ...init,
    headers: jsonHeaders(init),
  });
  return parseResponse(result);
}

export async function postClearPersonalization(
  init?: RequestInit,
): Promise<{ cleared: true }> {
  const result = await apiFetch("/_api/account/clear_personalization", {
    method: "POST",
    body: superjson.stringify({}),
    ...init,
    headers: jsonHeaders(init),
  });
  return parseResponse(result);
}

/** A photo still in a note, in the export, with a download link that lasts an hour (revamp 5). */
export type ExportedPhoto = {
  id: string;
  contentType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  createdAt: Date;
  noteIds: string[];
  /** Null when the server keeps no photos just now. */
  url: string | null;
};

export type AccountExport = {
  exportedAt: Date;
  notes: NoteRecord[];
  entities: { noteId: string; type: EntityType; name: string; aliases: string[] }[];
  projects: ProjectRecord[];
  tasks: TaskRecord[];
  /** Photos (revamp 5): absent from a server older than migration 017. */
  photos?: ExportedPhoto[];
  /** When the photos' links stop working. */
  photoLinksExpireAt?: Date | null;
  photoLinksNote?: string;
};

export async function getAccountExport(init?: RequestInit): Promise<AccountExport> {
  const result = await apiFetch("/_api/account/export", { method: "GET", ...init });
  return parseResponse(result);
}

export async function postAccountDelete(init?: RequestInit): Promise<{ deleted: true }> {
  const result = await apiFetch("/_api/account/delete", {
    method: "POST",
    body: superjson.stringify({ confirm: true }),
    ...init,
    headers: jsonHeaders(init),
  });
  return parseResponse(result);
}
