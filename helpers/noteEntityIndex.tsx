import { createHash } from "node:crypto";
import { aiChatJson, AiOutOfCreditsError, DEFAULT_MODEL } from "./ai";
import type { Insertable } from "kysely";
import { db } from "./db";
import type { NoteEntities, EntityType } from "./schema";
import { EntityTypeArrayValues } from "./schema";
import { isPersonalizationEnabled } from "./isPersonalizationEnabled";
import { parseModelJson } from "./parseModelJson";

/**
 * Per-user entity index extracted from notes (people, places, events,
 * activities, topics). It powers related-note retrieval for personalized
 * suggestions. Extraction never runs in the suggestion hot path and never
 * blocks a note save — the editor calls the reindex endpoint after typing
 * settles. Backend only.
 */

const EXTRACTION_MODEL = DEFAULT_MODEL;
const MAX_ENTITIES_PER_NOTE = 12;
const MAX_ALIASES = 4;
const MAX_NAME_LEN = 60;

export const BACKFILL_BATCH_SIZE = 3;

/** People and places identify related notes more strongly than loose topics. */
export const ENTITY_TYPE_WEIGHTS: Record<EntityType, number> = {
  person: 3,
  place: 3,
  event: 2,
  activity: 1.5,
  topic: 1,
};

/** Lowercase, strip punctuation, collapse whitespace — used for matching. */
export function normalizeEntity(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/'/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function contentHash(title: string, content: string): string {
  return createHash("sha256")
    .update(title)
    .update("")
    .update(content)
    .digest("hex");
}

const EXTRACTION_PROMPT = `You extract entities from a personal note so related notes can be found later.

Extract up to ${MAX_ENTITIES_PER_NOTE} distinct entities using these types:
- "person": named people or specific relations (e.g. "Mom", "Dr. Lee", "Sarah")
- "place": specific locations (e.g. "High Park", "the lake house")
- "event": specific occasions (e.g. "Sarah's wedding", "Mom's birthday")
- "activity": recurring activities or hobbies (e.g. "swimming", "book club")
- "topic": other concrete subjects (e.g. "medication schedule", "the garden")

Rules:
- Only include entities actually mentioned in the note.
- "name" uses the words from the note itself (at most 6 words).
- "aliases": up to ${MAX_ALIASES} other wordings for the same entity, including other ways this note refers to it (e.g. "my mother" for "Mom"). Only aliases you are confident about.
- Skip vague or generic words (today, things, stuff, note).
- Respond ONLY with JSON: {"entities":[{"type":"person","name":"...","aliases":["..."]}]}`;

type RawEntity = { type?: unknown; name?: unknown; aliases?: unknown };

function cleanEntities(
  raw: Record<string, unknown>,
  noteId: string,
  userId: number,
): Insertable<NoteEntities>[] {
  const list = Array.isArray(raw.entities) ? (raw.entities as RawEntity[]) : [];
  const seen = new Set<string>();
  const rows: Insertable<NoteEntities>[] = [];
  for (const item of list) {
    if (rows.length >= MAX_ENTITIES_PER_NOTE) break;
    if (typeof item?.name !== "string" || typeof item?.type !== "string") continue;
    const type = item.type.toLowerCase();
    if (!(EntityTypeArrayValues as readonly string[]).includes(type)) continue;
    const name = item.name.trim().replace(/\s+/g, " ");
    if (!name || name.length > MAX_NAME_LEN) continue;
    const normalizedName = normalizeEntity(name);
    if (normalizedName.length < 2) continue;
    if (seen.has(normalizedName)) continue;
    seen.add(normalizedName);
    const aliases = (Array.isArray(item.aliases) ? item.aliases : [])
      .filter((a): a is string => typeof a === "string")
      .map((a) => a.trim().replace(/\s+/g, " "))
      .filter(
        (a) =>
          a.length > 0 &&
          a.length <= MAX_NAME_LEN &&
          normalizeEntity(a).length >= 2 &&
          normalizeEntity(a) !== normalizedName,
      )
      .slice(0, MAX_ALIASES);
    rows.push({
      noteId,
      userId,
      type: type as EntityType,
      name,
      normalizedName,
      aliases: [...new Set(aliases)],
    });
  }
  return rows;
}

/**
 * Extract entities for one note (skips when unchanged, archived, missing, or
 * personalization is off). Returns true when the index was written.
 */
export async function noteEntityIndex(
  noteId: string,
  userId: number,
): Promise<boolean> {
  if (!(await isPersonalizationEnabled(userId))) return false;

  const note = await db
    .selectFrom("notes")
    .selectAll()
    .where("id", "=", noteId)
    .where("userId", "=", userId)
    .executeTakeFirst();
  if (!note || note.archived) return false;

  const hash = contentHash(note.title, note.content);
  if (note.entitiesHash === hash) return false;

  const text = `${note.title}\n${note.content}`.trim();
  let rows: Insertable<NoteEntities>[] = [];
  // A note with genuinely no entities is a real answer; a model reply we
  // could not read is not. Only the first should mark the note as indexed,
  // or a bad reply would freeze the note out of retrieval for good.
  let extracted = true;
  if (normalizeEntity(text).length >= 3) {
    // Plain labelling work: the fast model keeps indexing well clear of the
    // writer, and it never blocks a save either way.
    const raw = await aiChatJson({
      model: EXTRACTION_MODEL,
      systemPrompt: EXTRACTION_PROMPT,
      userPrompt: text.slice(0, 6_000),
      maxOutputTokens: 2_000,
    });
    const parsed = parseModelJson(raw);
    extracted = Array.isArray(parsed.entities);
    if (extracted) {
      rows = cleanEntities(parsed, noteId, userId);
    }
  }

  if (!extracted) {
    console.warn(
      "entity extraction returned nothing readable; leaving this note unindexed so it is retried later",
    );
    return false;
  }

  // Commit only if nothing changed while the model ran: the note row is
  // locked, then content hash, archive state and personalization are all
  // rechecked so a concurrent edit/archive/opt-out is never overwritten
  // with stale entities.
  return db.transaction().execute(async (trx) => {
    const current = await trx
      .selectFrom("notes")
      .selectAll()
      .where("id", "=", noteId)
      .where("userId", "=", userId)
      .forUpdate()
      .executeTakeFirst();
    if (!current || current.archived) return false;
    if (contentHash(current.title, current.content) !== hash) return false;

    const prefs = await trx
      .selectFrom("userPreferences")
      .select("usePersonalization")
      .where("userId", "=", userId)
      .executeTakeFirst();
    if (prefs && !prefs.usePersonalization) return false;

    await trx.deleteFrom("noteEntities").where("noteId", "=", noteId).execute();
    if (rows.length > 0) {
      await trx.insertInto("noteEntities").values(rows).execute();
    }
    await trx
      .updateTable("notes")
      .set({ entitiesHash: hash })
      .where("id", "=", noteId)
      .execute();
    return true;
  });
}

/**
 * Remove a note's entities and clear its index marker, so it can be
 * re-indexed later if it is unarchived.
 */
export async function removeNoteEntities(noteId: string): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom("noteEntities").where("noteId", "=", noteId).execute();
    await trx
      .updateTable("notes")
      .set({ entitiesHash: null })
      .where("id", "=", noteId)
      .execute();
  });
}

/**
 * Index notes that have never been extracted (newest first), a small batch
 * at a time. Returns how many notes were indexed.
 */
export async function backfillUserEntities(
  userId: number,
  limit: number = BACKFILL_BATCH_SIZE,
): Promise<number> {
  const rows = await db
    .selectFrom("notes")
    .select("id")
    .where("userId", "=", userId)
    .where("archived", "=", false)
    .where("entitiesHash", "is", null)
    .orderBy("updatedAt", "desc")
    .limit(limit)
    .execute();

  let indexed = 0;
  for (const row of rows) {
    try {
      if (await noteEntityIndex(row.id, userId)) indexed += 1;
    } catch (error) {
      if (error instanceof AiOutOfCreditsError) throw error;
      // Never log note text or entity names — counts only.
      console.warn("entity extraction failed for one note during backfill");
    }
  }
  return indexed;
}