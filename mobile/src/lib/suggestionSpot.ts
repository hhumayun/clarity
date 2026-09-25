/**
 * Where a set of writing suggestions belongs. They are made for one spot in
 * the note (the text before the cursor when they were asked for), so they
 * only make sense while the cursor is still there. No React Native imports,
 * so this can be tested on its own.
 */

function isBoundary(text: string, i: number, end: number): boolean {
  const ch = text[i];
  if (ch === "\n") return true;
  if (ch !== "." && ch !== "!" && ch !== "?") return false;
  // A full stop ends a sentence when a space follows, or when it is the last
  // thing before the cursor (the writer has just finished the sentence). One
  // inside a number ("3.5") or a word ("e.g" mid-typing) does not.
  const next = i + 1;
  return next === end || /\s/.test(text[next] ?? "");
}

/**
 * The offset where the sentence around `pos` begins: just after the previous
 * sentence's end, or 0. Two offsets with the same key are in the same
 * sentence. An abbreviation such as "Mr. Lee" counts as a boundary, which
 * only ever hides a set of suggestions a little early.
 */
export function sentenceKey(text: string, pos: number): number {
  const end = Math.max(0, Math.min(pos, text.length));
  for (let i = end - 1; i >= 0; i--) {
    if (isBoundary(text, i, end)) return i + 1;
  }
  return 0;
}

/** Whether offsets `a` and `b` fall in the same sentence of `text`. */
export function sameSentence(text: string, a: number, b: number): boolean {
  return sentenceKey(text, a) === sentenceKey(text, b);
}
