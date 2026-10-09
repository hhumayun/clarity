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
  /** Only notes tagged with this area. */
  projectId: z.string().min(1).max(64).optional(),
});
export type ListNotesInput = z.infer<typeof listNotesSchema>;

/**
 * A note as the lists keep it: without its rich text. The lists only show
 * and search the Markdown, and the copy of them kept on the phone for offline
 * use is written whole, so it stays small. The note screen fetches the rich
 * text, and the phone keeps it for opened notes (noteDocs).
 */
export function withoutDoc(note: NoteRecord): NoteRecord {
  if (note.doc === undefined) return note;
  const { doc: _doc, ...rest } = note;
  return rest;
}

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
  if (validated.projectId) search.set("projectId", validated.projectId);
  const query = search.toString();
  const result = await apiFetch(`/_api/notes/list${query ? `?${query}` : ""}`, {
    method: "GET",
    ...init,
  });
  const list = await parseResponse<{ notes: NoteRecord[] }>(result);
  return { notes: list.notes.map(withoutDoc) };
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
  if (validated.projectId) search.set("projectId", validated.projectId);
  const result = await apiFetch(`/_api/notes/list?${search.toString()}`, {
    method: "GET",
    ...init,
  });
  const page = await parseResponse<{ notes: NoteRecord[]; nextCursor?: string | null }>(result);
  return { notes: page.notes.map(withoutDoc), nextCursor: page.nextCursor ?? null };
}

/** Whole counts, so the list need not load every note to show one. */
export async function getNoteCounts(init?: RequestInit): Promise<{ archived: number }> {
  const result = await apiFetch("/_api/notes/counts", { method: "GET", ...init });
  return parseResponse(result);
}

/**
 * A title idea for an untitled note, from its text as it stands in the
 * editor. Null when the model has nothing useful; nothing is saved.
 */
export async function postSuggestTitle(
  body: { content: string },
  init?: RequestInit,
): Promise<{ title: string | null }> {
  const result = await apiFetch("/_api/notes/suggest_title", {
    method: "POST",
    body: superjson.stringify(body),
    ...init,
    headers: jsonHeaders(init),
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

/**
 * A note saved. `missingPhotos`: photos it names that the server doesn't
 * have, for the phone to upload if it has them (revamp 5). The body is sent
 * as given, never parsed against a schema here, so no field is stripped.
 */
export type NoteSaved = { note: NoteRecord; missingPhotos?: string[] };

export async function postNoteCreate(
  body: {
    /** Made on the phone (it may be sent later, from the outbox). */
    id?: string;
    createdAt?: Date;
    title?: string;
    content?: string;
    /** The rich text as the editor keeps it; `content` is its Markdown. */
    doc?: unknown;
    source?: "focus" | "page";
    /** For a thought parked during focus time: the task being worked on. */
    taskId?: string;
    projectIds?: string[];
  },
  init?: RequestInit,
): Promise<NoteSaved> {
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
    /** Sent with `content`. New words without it clear it on the server. */
    doc?: unknown;
    archived?: boolean;
    projectIds?: string[];
    /** When the change was made on the phone; the server keeps it, never later than now (revamp 5). */
    changedAt?: Date;
    /**
     * Photos the writer took out of the note (revamp 5). The server puts back,
     * at the end, any photo the note had that a save neither names nor lists here.
     */
    removedPhotos?: string[];
  },
  init?: RequestInit,
): Promise<NoteSaved> {
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
