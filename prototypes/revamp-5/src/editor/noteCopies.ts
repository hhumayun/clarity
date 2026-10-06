/**
 * Which copy of a note goes on screen: the main app's rules (its note
 * screen's `applyNote` and the server check after it, at 4344bd8), as pure
 * functions so they can be tested on their own. Kept apart from React and
 * the network: plain values in, a yes or no out.
 */

type Copy = { updatedAt: Date | string; content: string; doc?: unknown };

const timeOf = (value: Date | string) => new Date(value).getTime();

/**
 * The draft on the phone wins over the server's copy when it was written
 * after the copy's time. With edit times (`changedAt`), the server's copy
 * carries when an edit was made, not when it arrived: a draft written after
 * that edit still wins, and an edit made later anywhere else beats an older draft.
 */
export function draftWins(draft: { at: number } | null, server: Copy): boolean {
  return Boolean(draft && draft.at > timeOf(server.updatedAt));
}

/**
 * A copy fetched from the server replaces the one on screen only if:
 * - the screen didn't open from a draft;
 * - nothing typed here is waiting to be sent;
 * - nothing has been typed since it opened;
 * - and the fetched copy is newer, or has the same words with the rich text the phone lacked.
 * Words are never swapped out under the writer.
 */
export function serverCopyReplaces(opts: { openedFromDraft: boolean; waiting: boolean; untouched: boolean; shown: Copy; fetched: Copy }): boolean {
  const { openedFromDraft, waiting, untouched, shown, fetched } = opts;
  if (openedFromDraft || waiting || !untouched) return false;
  const newer = timeOf(fetched.updatedAt) > timeOf(shown.updatedAt);
  const bringsRichText = shown.doc == null && fetched.doc != null && fetched.content === shown.content;
  return newer || bringsRichText;
}
