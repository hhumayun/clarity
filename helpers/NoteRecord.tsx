import type { Selectable } from "kysely";
import type { Notes } from "./schema";

/**
 * A note as the app sees it. The entity-index bookkeeping column never
 * leaves the server.
 */
export type NoteRecord = Omit<Selectable<Notes>, "entitiesHash" | "userId" | "taskId"> & {
  /** The projects ("areas") this note is tagged with. */
  projectIds: string[];
};

/**
 * A note as the lists carry it: without its rich text (`doc`). Lists only
 * show and search the words, and the phone keeps its copy of them for
 * offline use, written whole, so it stays small. A single note (notes/get)
 * comes with it.
 */
export type NoteListRecord = Omit<NoteRecord, "doc">;

export const NOTE_RECORD_COLUMNS = [
  "id",
  "title",
  "content",
  "doc",
  "archived",
  "source",
  "createdAt",
  "updatedAt",
] as const;

/** The columns of a note in a list: all but its rich text. */
export const NOTE_LIST_COLUMNS = NOTE_RECORD_COLUMNS.filter(
  (column): column is Exclude<(typeof NOTE_RECORD_COLUMNS)[number], "doc"> => column !== "doc",
);
