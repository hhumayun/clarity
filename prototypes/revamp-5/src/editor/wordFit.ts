/**
 * How offered words go in at the cursor: cased and spaced for where they
 * land. The main app's rules (`insertSuggestion` in its note screen), with
 * two small additions: "I" keeps its capital mid-sentence, and no space goes
 * before punctuation that follows the cursor.
 */

/** One to finish the sentence at the cursor, or one to start the next. */
export type WordKind = "finish" | "start";

/** The sentence before the cursor is over (or there's none yet). */
export function sentenceOver(before: string): boolean {
  const trimmed = before.trimEnd();
  return trimmed.length === 0 || /[.!?]$/.test(trimmed) || /\n\s*$/.test(before);
}

const upper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
// "I", "I'm", "I've"… keep their capital wherever they go.
const lower = (text: string) => (/^I(\b|['’])/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1));

/**
 * The text to insert, and whether the spaces before the cursor go first (a
 * new sentence after an unfinished one closes it with a full stop).
 */
export function fitWords(words: string, kind: WordKind, before: string, after: string): { text: string; trimBefore: boolean } {
  const trimmedBefore = before.trimEnd();
  // At the start of the note or of a line, a new sentence starts.
  const lineStart = trimmedBefore.length === 0 || /\n\s*$/.test(before);
  const midClause = /[,;:({["'‘“–—-]$/.test(trimmedBefore);
  const over = lineStart || /[.!?]$/.test(trimmedBefore);

  let text = words.trim();
  let endSentence = false;
  if (kind === "finish") {
    // Finishes the sentence it follows, in the model's own casing, unless
    // there's no sentence left to finish.
    if (over) text = upper(text);
  } else if (over) {
    text = upper(text);
  } else if (midClause) {
    text = lower(text);
  } else {
    // The sentence before it ends first.
    endSentence = true;
    text = upper(text);
  }

  const lead = endSentence ? `${trimmedBefore}.` : before;
  const spaceBefore = !lineStart && lead.length > 0 && !/\s$/.test(lead) && !/^[,.!?;:'")\]]/.test(text);
  const spaceAfter = after.length === 0 || !/^[\s,.!?;:'")\]]/.test(after);
  return { text: (endSentence ? "." : "") + (spaceBefore ? " " : "") + text + (spaceAfter ? " " : ""), trimBefore: endSentence };
}
