import type { Kysely, Transaction } from "kysely";
import type { SuggestedTask } from "../endpoints/tasks/extract_POST.schema";
import type { DB } from "./schema";
import { taskFingerprint } from "./taskFingerprint";

type Executor = Kysely<DB> | Transaction<DB>;

/**
 * Find tasks' suggestions are kept until the writer decides, so leaving a
 * note no longer loses them. A suggestion stays pending until it's added
 * (tasks/add clears it) or dismissed. Dismissed ones stay too, marked, so
 * the same words aren't offered again for that note. Rows go with their
 * note (migration 014).
 */

/** Words compared the way fingerprints compare them. */
export function sameWords(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/** A note's undecided suggestions, in the order they were found. */
export async function pendingSuggestions(executor: Executor, noteId: string, userId: number): Promise<SuggestedTask[]> {
  const rows = await executor
    .selectFrom("taskSuggestions")
    .select(["text", "projectName", "completeBy"])
    .where("noteId", "=", noteId)
    .where("userId", "=", userId)
    .where("status", "=", "pending")
    .orderBy("createdAt", "asc")
    .orderBy("id", "asc")
    .execute();
  return rows.map((row) => ({ text: row.text, projectName: row.projectName, completeBy: row.completeBy }));
}

/** Fingerprints of what the writer has turned down in this note. */
export async function dismissedFingerprints(executor: Executor, noteId: string, userId: number): Promise<Set<string>> {
  const rows = await executor
    .selectFrom("taskSuggestions")
    .select("fingerprint")
    .where("noteId", "=", noteId)
    .where("userId", "=", userId)
    .where("status", "=", "dismissed")
    .execute();
  return new Set(rows.map((row) => row.fingerprint));
}

/** A fresh look replaces the note's pending suggestions with what it found; dismissed ones are left as they are. */
export async function replacePendingSuggestions(executor: Executor, noteId: string, userId: number, suggested: SuggestedTask[]): Promise<void> {
  await executor.deleteFrom("taskSuggestions").where("noteId", "=", noteId).where("userId", "=", userId).where("status", "=", "pending").execute();
  if (suggested.length === 0) return;
  await executor
    .insertInto("taskSuggestions")
    .values(
      suggested.map((item) => ({
        userId,
        noteId,
        fingerprint: taskFingerprint(noteId, item.text),
        text: item.text,
        projectName: item.projectName,
        completeBy: item.completeBy,
      })),
    )
    .onConflict((conflict) => conflict.columns(["noteId", "fingerprint"]).doNothing())
    .execute();
}

/** Suggestions that became tasks stop being pending. */
export async function clearPendingSuggestions(executor: Executor, noteId: string, userId: number, texts: string[]): Promise<void> {
  if (texts.length === 0) return;
  await executor
    .deleteFrom("taskSuggestions")
    .where("noteId", "=", noteId)
    .where("userId", "=", userId)
    .where("status", "=", "pending")
    .where(
      "fingerprint",
      "in",
      texts.map((text) => taskFingerprint(noteId, text)),
    )
    .execute();
}

/** "Not now": remembered, even for a suggestion that was never stored, so it isn't offered again for this note. */
export async function dismissSuggestion(executor: Executor, noteId: string, userId: number, text: string): Promise<void> {
  await executor
    .insertInto("taskSuggestions")
    .values({ userId, noteId, fingerprint: taskFingerprint(noteId, text), text: text.trim(), status: "dismissed" })
    .onConflict((conflict) => conflict.columns(["noteId", "fingerprint"]).doUpdateSet({ status: "dismissed" }))
    .execute();
}
