import { z } from "zod";
import superjson from "superjson";
import { apiFetch } from "./apiFetch";
import { jsonHeaders, parseResponse } from "./parse";
import type { NoteRecord } from "../types";

export const listNotesSchema = z.object({
  q: z.string().max(200).optional(),
  archived: z.boolean().optional(),
});
export type ListNotesInput = z.infer<typeof listNotesSchema>;

export async function getNotesList(
  params: ListNotesInput = {},
  init?: RequestInit,
): Promise<{ notes: NoteRecord[] }> {
  const validated = listNotesSchema.parse(params);
  const search = new URLSearchParams();
  if (validated.q) search.set("q", validated.q);
  if (validated.archived) search.set("archived", "true");
  const query = search.toString();
  const result = await apiFetch(`/_api/notes/list${query ? `?${query}` : ""}`, {
    method: "GET",
    ...init,
  });
  return parseResponse(result);
}

export async function getNote(
  params: { id: string },
  init?: RequestInit,
): Promise<{ note: NoteRecord }> {
  const search = new URLSearchParams({ id: params.id });
  const result = await apiFetch(`/_api/notes/get?${search.toString()}`, {
    method: "GET",
    ...init,
  });
  return parseResponse(result);
}

export async function postNoteCreate(
  body: { title?: string; content?: string },
  init?: RequestInit,
): Promise<{ note: NoteRecord }> {
  const result = await apiFetch("/_api/notes/create", {
    method: "POST",
    body: superjson.stringify(body),
    ...init,
    headers: jsonHeaders(init),
  });
  return parseResponse(result);
}

export async function postNoteUpdate(
  body: {
    id: string;
    title?: string;
    content?: string;
    archived?: boolean;
  },
  init?: RequestInit,
): Promise<{ note: NoteRecord }> {
  const result = await apiFetch("/_api/notes/update", {
    method: "POST",
    body: superjson.stringify(body),
    ...init,
    headers: jsonHeaders(init),
  });
  return parseResponse(result);
}

export async function postNoteDelete(
  body: { id: string },
  init?: RequestInit,
): Promise<{ deleted: true }> {
  const result = await apiFetch("/_api/notes/delete", {
    method: "POST",
    body: superjson.stringify(body),
    ...init,
    headers: jsonHeaders(init),
  });
  return parseResponse(result);
}

export async function postNotesReindex(
  body: { noteId?: string },
  init?: RequestInit,
): Promise<{ indexed: number }> {
  const result = await apiFetch("/_api/notes/reindex", {
    method: "POST",
    body: superjson.stringify(body),
    ...init,
    headers: jsonHeaders(init),
  });
  return parseResponse(result);
}
