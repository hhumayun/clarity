import type { Selectable } from "kysely";
import type { Notes } from "./schema";

/**
 * A note as the app sees it. The entity-index bookkeeping column never
 * leaves the server.
 */
export type NoteRecord = Omit<Selectable<Notes>, "entitiesHash" | "userId">;

export const NOTE_RECORD_COLUMNS = [
  "id",
  "title",
  "content",
  "archived",
  "createdAt",
  "updatedAt",
] as const;