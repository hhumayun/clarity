import { createHash } from "node:crypto";

export function taskFingerprint(noteId: string, text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return createHash("sha256").update(noteId).update("\0").update(normalized).digest("hex");
}
