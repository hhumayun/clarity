import { z } from "zod";

/** The longest rich document kept, as JSON text. Its Markdown may be 100,000. */
export const MAX_NOTE_DOC_CHARS = 500_000;

/**
 * A note's rich text as the editor sends it: Tiptap's JSON document. Only
 * its outline is checked here; the editor is what reads it.
 */
export const noteDocSchema = z
  .record(z.string(), z.unknown())
  .refine((doc) => doc.type === "doc", "That note's formatting could not be read.")
  .refine((doc) => JSON.stringify(doc).length <= MAX_NOTE_DOC_CHARS, "That note is too long to keep its formatting.");
