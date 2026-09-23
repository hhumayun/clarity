import type { Selectable } from "kysely";
import type { Notes } from "./schema";

/**
 * A note as the app sees it. The entity-index bookkeeping column never
 * leaves the server.
 */
export type NoteRecord = Omit<Selectable<Notes>, "entitiesHash" | "userId"> & {
  /** The projects ("areas") this note is tagged with. */
  projectIds: string[];
};

export const NOTE_RECORD_COLUMNS = [
  "id",
  "title",
  "content",
  "archived",
  "source",
  "createdAt",
  "updatedAt",
] as const;