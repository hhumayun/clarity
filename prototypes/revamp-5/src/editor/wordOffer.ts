import type { SuggestionSource } from "../core/types";
import { fitWords, sentenceOver, type WordKind } from "./wordFit";

/** A few words offered: to finish the sentence at the cursor, or to start the next. */
export type WordIdea = { text: string; kind: WordKind; source: SuggestionSource };

/**
 * What word help offered, and for which words: `anchor` is the text before
 * the cursor when it asked (the editor sends up to 600 characters of it).
 */
export type Offer = { id: number; anchor: string; finishes: WordIdea[]; starts: WordIdea[] };

/** An idea that still fits, and how much of it is typed already (only the rest goes in). */
export type Fit = { idea: WordIdea; typed: string };

// Written this far past what was offered, it's out of date: new words come at the next pause.
const HOLD_CHARS = 80;
// The end of an anchor too long to compare whole (the editor's window moves on as the writer types).
const TAIL_CHARS = 120;

/** What's been typed since the offer was made, or null if the cursor isn't writing on from there. */
export function typedSince(anchor: string, before: string): string | null {
  let typed: string | null = null;
  if (before.startsWith(anchor)) {
    typed = before.slice(anchor.length);
  } else if (anchor.length > TAIL_CHARS) {
    // The window before the cursor has moved: find where the offer's words end.
    const tail = anchor.slice(-TAIL_CHARS);
    const at = before.lastIndexOf(tail);
    if (at >= 0) typed = before.slice(at + tail.length);
  }
  return typed !== null && typed.length <= HOLD_CHARS ? typed : null;
}

/** Where the last sentence typed ends: just after its . ! ? or the new line (-1: none). */
function lastBreak(typed: string): number {
  let at = -1;
  for (let i = 0; i < typed.length; i++) {
    const char = typed[i];
    if (char === "\n") at = i + 1;
    else if (".!?".includes(char) && (i + 1 === typed.length || /\s/.test(typed[i + 1]))) at = i + 1;
  }
  return at;
}

/** The ideas that begin with what's typed (any case), and aren't typed out already. */
function beginningWith(ideas: WordIdea[], typed: string): Fit[] {
  const lower = typed.toLowerCase();
  return ideas.filter((idea) => idea.text.toLowerCase().startsWith(lower) && typed.trimEnd().length < idea.text.length).map((idea) => ({ idea, typed }));
}

/**
 * What of an offer still fits as the writer types on (null: none of it, the
 * cursor went elsewhere or back past it). Ways to finish the sentence fit
 * while the sentence goes on and what's typed is how they begin; ways to
 * start the next fit until another sentence is begun, and then while it
 * begins as they do. So typing a word an idea starts with keeps it, and the
 * strip doesn't change with every key.
 */
export function fitsNow(offer: Offer, before: string): { finishes: Fit[]; starts: Fit[] } | null {
  const typed = typedSince(offer.anchor, before);
  if (typed === null) return null;
  const end = lastBreak(typed);
  const anchorOver = sentenceOver(offer.anchor);
  const finishes = !anchorOver && end < 0 ? beginningWith(offer.finishes, typed.trimStart()) : [];
  let starts: Fit[];
  if (end >= 0) starts = beginningWith(offer.starts, typed.slice(end).trimStart());
  else if (anchorOver) starts = beginningWith(offer.starts, typed.trimStart());
  // Still in the sentence the offer was made in: a start would end it first.
  else starts = offer.starts.map((idea) => ({ idea, typed: "" }));
  return finishes.length || starts.length ? { finishes, starts } : null;
}

/** The text to put in for an idea that fits: all of it, cased and spaced, or the rest of what's begun. */
export function insertionFor(fit: Fit, before: string, after: string): { text: string; trimBefore: boolean } {
  if (!fit.typed.trim()) return fitWords(fit.idea.text, fit.idea.kind, before, after);
  const rest = fit.idea.text.slice(fit.typed.length);
  const spaceAfter = after.length === 0 || !/^[\s,.!?;:'")\]]/.test(after);
  return { text: rest + (spaceAfter ? " " : ""), trimBefore: false };
}

/** The same ideas, in the same order. */
export function sameIdeas(a: WordIdea[], b: WordIdea[]): boolean {
  return a.length === b.length && a.every((idea, i) => idea.text === b[i].text && idea.kind === b[i].kind);
}

/**
 * Whether new words are wanted where the cursor is now: nothing offered
 * fits, the sentence goes on and no way to finish it does, a sentence was
 * begun and no way to start it does, or the writer has moved well past what
 * was offered. Otherwise what's there still fits, and stays.
 */
export function wantsNew(offer: Offer | null, before: string): boolean {
  if (!offer) return true;
  const typed = typedSince(offer.anchor, before);
  if (typed === null || typed.length >= 25) return true;
  const fits = fitsNow(offer, before);
  if (!fits) return true;
  const midSentence = !sentenceOver(before);
  if (midSentence && fits.finishes.length === 0) return true;
  if (!midSentence && fits.starts.length === 0) return true;
  return false;
}
