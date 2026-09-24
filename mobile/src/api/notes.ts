import { z } from "zod";
import superjson from "superjson";
import { apiFetch } from "./apiFetch";
import { jsonHeaders, parseResponse } from "./parse";
import type { NoteRecord } from "../types";

export const listNotesSchema = z.object({
  q: z.string().max(200).optional(),
  archived: z.boolean().optional(),
  /** Notes written from this moment... */
  from: z.date().optional(),
  /** ...until (not including) this one. */
  to: z.date().optional(),
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
  if (validated.from) search.set("from", validated.from.toISOString());
  if (validated.to) search.set("to", validated.to.toISOString());
  const query = search.toString();
  const result = await apiFetch(`/_api/notes/list${query ? `?${query}` : ""}`, {
    method: "GET",
    ...init,
  });
  return parseResponse(result);
}

export type NotesPage = { notes: NoteRecord[]; nextCursor: string | null };

/**
 * One page of notes, newest written first. Pass `nextCursor` back as
 * `cursor` for the page after; it is null on the last page.
 */
export async function getNotesPage(
  params: ListNotesInput & { limit: number; cursor?: string },
  init?: RequestInit,
): Promise<NotesPage> {
  const validated = listNotesSchema.parse(params);
  const search = new URLSearchParams({ limit: String(params.limit) });
  if (params.cursor) search.set("cursor", params.cursor);
  if (validated.q) search.set("q", validated.q);
  if (validated.archived) search.set("archived", "true");
  if (validated.from) search.set("from", validated.from.toISOString());
  if (validated.to) search.set("to", validated.to.toISOString());
  const result = await apiFetch(`/_api/notes/list?${search.toString()}`, {
    method: "GET",
    ...init,
  });
  const page = await parseResponse<{ notes: NoteRecord[]; nextCursor?: string | null }>(result);
  return { notes: page.notes, nextCursor: page.nextCursor ?? null };
}

/** Whole counts, so the list need not load every note to show one. */
export async function getNoteCounts(init?: RequestInit): Promise<{ archived: number }> {
  const result = await apiFetch("/_api/notes/counts", { method: "GET", ...init });
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
  body: { title?: string; content?: string; source?: "focus"; projectIds?: string[] },
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
    projectIds?: string[];
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
