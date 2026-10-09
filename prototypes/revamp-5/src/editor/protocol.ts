/**
 * What the note page and the editor page inside it say to each other. The
 * editor page is built ahead of time into one HTML file (`editor/`, built by
 * `npm run editor` into `src/editor/page.ts`) and loaded in a plain web view,
 * so a note opens offline, in Expo Go too. Both sides import this file, so
 * the two can't drift apart. Plain types only: no React Native, no DOM.
 */

/** The formats where the cursor is, for the tools row. */
export type EditorFormats = {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  heading: boolean;
  quote: boolean;
  bullet: boolean;
  ordered: boolean;
  task: boolean;
  /** The link the cursor is in, if any. */
  link: string | null;
  /** Whether some text is selected. */
  selection: boolean;
};

/** The words either side of the cursor, as plain text, for word help. */
export type EditorCursor = { before: string; after: string };

/** Sage's look, resolved for the theme in use (light or dark, the accent). */
export type EditorLook = {
  placeholder: string;
  colors: {
    /** The page the words sit on. */
    card: string;
    ink: string;
    ink2: string;
    ink3: string;
    line: string;
    sunken: string;
    accent: string;
    onAccent: string;
    accentText: string;
  };
  /** The body, and the questions (quotes), in points: Sage's `body` and `prompt`. */
  body: { size: number; lineHeight: number };
  question: { size: number; lineHeight: number };
  /** Room around the words, in points. */
  padding: { top: number; side: number; bottom: number };
};

export type EditorCommand =
  | "bold"
  | "italic"
  | "strike"
  | "heading"
  | "quote"
  | "bullet"
  | "ordered"
  | "task"
  | "indent"
  | "outdent"
  | "link"
  | "insertText"
  /**
   * `value` is JSON `{ text, kind, anchor }`: words from word help's strip, fitted
   * here against what's really typed (the app's idea of it can be a moment
   * behind): only the rest of words already begun, cased and spaced. Answered
   * with "inserted".
   */
  | "insertWords"
  | "insertQuestion"
  | "flush"
  | "tray"
  | "keyboard"
  | "focus"
  | "blur"
  /** `value`: points at the bottom of the page covered by something over it (word help's strip); the line being written stays clear of them. */
  | "inset";

/** To the page. */
export type ToPage =
  | { type: "look"; look: EditorLook }
  /**
   * The note, taken in whenever `seed` changes: its rich text (`doc`) when it
   * has one, else its Markdown. `focus` puts the cursor in it once it's in.
   */
  | { type: "seed"; seed: string; markdown: string; doc: unknown; focus: "end" | null }
  | { type: "run"; name: EditorCommand; value?: string };

/** From the page. */
export type FromPage =
  /** The page is up and has an editor: send the look, the note, then anything waiting. */
  | { type: "ready" }
  /** The note `seed` brought is on screen. */
  | { type: "shown"; seed: string }
  /**
   * The note as it now stands: its Markdown (for search, the AI, previews) and
   * its rich text, together, and when they left the page. Sent once typing
   * pauses, at least every second while it doesn't, and at once when the
   * keyboard closes, the page is hidden, or the app asks (`flush`).
   */
  | { type: "change"; markdown: string; doc: unknown; at: number }
  | { type: "cursor"; cursor: EditorCursor }
  | { type: "formats"; formats: EditorFormats }
  | { type: "focus"; focused: boolean }
  /** A checklist row ticked (or unticked) by a tap: the app answers with a haptic. */
  | { type: "ticked"; on: boolean }
  /** Words from the strip went in (insertWords): the text now before the cursor, and how many characters went in. */
  | { type: "inserted"; before: string; length: number }
  | { type: "error"; message: string };

/** The global the page listens on; the app calls it with `injectJavaScript`. */
export const PAGE_RECEIVER = "clarityEditor";
