import { sql, type Kysely, type SelectQueryBuilder } from "kysely";
import type { DB } from "./schema";
import { NOTE_RECORD_COLUMNS, type NoteRecord } from "./NoteRecord";
import { attachProjectIds } from "./noteProjects";

export type NoteFilters = {
  archived?: boolean;
  /** Words to find in the title, the text, or a tagged area's name. */
  q?: string;
  /** Only notes written at or after this moment... */
  from?: Date;
  /** ...and before this one. */
  to?: Date;
};

/** The filters every notes list shares: whose, archived or not, dates, words. */
export function filterNotes<O>(
  query: SelectQueryBuilder<DB, "notes", O>,
  userId: number,
  filters: NoteFilters,
): SelectQueryBuilder<DB, "notes", O> {
  let filtered = query
    .where("userId", "=", userId)
    .where("archived", "=", filters.archived === true);
  if (filters.from) filtered = filtered.where("createdAt", ">=", filters.from);
  if (filters.to) filtered = filtered.where("createdAt", "<", filters.to);

  const term = filters.q?.trim();
  if (term) {
    const pattern = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    filtered = filtered.where((eb) =>
      eb.or([
        eb("title", "ilike", pattern),
        eb("content", "ilike", pattern),
        // Searching an area's name finds the notes tagged with it.
        eb.exists(
          eb
            .selectFrom("noteProjects")
            .innerJoin("projects", "projects.id", "noteProjects.projectId")
            .select("noteProjects.noteId")
            .whereRef("noteProjects.noteId", "=", "notes.id")
            .where("projects.name", "ilike", pattern),
        ),
      ]),
    );
  }
  return filtered;
}

// Postgres's text form of a timestamptz, e.g. "2026-09-23 16:26:19.314123+00".
const PG_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;

/**
 * Where a page ended, as an opaque string. The time is Postgres's own text
 * form, microseconds and all: a JS Date keeps only milliseconds, and a
 * cursor rounded that way would skip or repeat notes written in the same
 * millisecond as the page boundary.
 */
export function encodeCursor(createdAtText: string, id: string): string {
  return Buffer.from(JSON.stringify([createdAtText, id]), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(value) && value.length === 2) {
      const [createdAt, id] = value;
      if (
        typeof createdAt === "string" && PG_TIMESTAMP.test(createdAt) &&
        typeof id === "string" && id.length > 0 && id.length <= 64
      ) {
        return { createdAt, id };
      }
    }
  } catch {
    // Falls through to the error below.
  }
  throw new Error("That page of notes could not be found. Please refresh the list.");
}

/**
 * One page of a person's notes, newest written first. Pass the returned
 * `nextCursor` back for the page after; it is null on the last page.
 */
export async function listNotesPage(
  db: Kysely<DB>,
  userId: number,
  input: NoteFilters & { limit: number; cursor?: string },
): Promise<{ notes: NoteRecord[]; nextCursor: string | null }> {
  let query = filterNotes(
    db
      .selectFrom("notes")
      .select([...NOTE_RECORD_COLUMNS])
      .select(sql<string>`notes.created_at::text`.as("createdAtText")),
    userId,
    input,
  );
  if (input.cursor) {
    const after = decodeCursor(input.cursor);
    // Strictly older than the last note of the previous page, in the same
    // (created_at, id) order the page was sorted by. The time goes in as
    // text and is converted by Postgres: typed as a timestamp, the driver
    // would turn it into a JS Date first and lose the microseconds.
    query = query.where(
      sql<boolean>`(notes.created_at, notes.id) < (${after.createdAt}::text::timestamptz, ${after.id}::text)`,
    );
  }
  // One extra row says whether another page follows.
  const rows = await query
    .orderBy("createdAt", "desc")
    .orderBy("id", "desc")
    .limit(input.limit + 1)
    .execute();

  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  const nextCursor = rows.length > input.limit && last ? encodeCursor(last.createdAtText, last.id) : null;
  const notes = await attachProjectIds(
    db,
    page.map(({ createdAtText: _createdAtText, ...note }) => note),
    userId,
  );
  return { notes, nextCursor };
}
