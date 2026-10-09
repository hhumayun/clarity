/**
 * The note editor's page: Tiptap (ProseMirror) reading and writing Markdown,
 * in Sage's look. Built into one HTML file (`npm run editor`) that the note
 * page loads in a plain web view, so it opens offline, in Expo Go too.
 *
 * The app talks to it through `window.clarityEditor.receive(...)` and hears
 * back through `ReactNativeWebView.postMessage` (src/editor/protocol.ts).
 * Its editing rules are the main app's (./extensions.ts); what's Sage's own
 * is the look, and questions going in as quotes.
 */
import { Editor, type JSONContent } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import {
  PAGE_RECEIVER,
  type EditorCommand,
  type EditorCursor,
  type EditorFormats,
  type EditorLook,
  type FromPage,
  type ToPage,
} from "../src/editor/protocol";
import {
  Indent,
  IndentedParagraph,
  LineBreak,
  LineStartBackspace,
  MAX_INDENT,
  NoteLink,
  PHOTO_PREFIX,
  Photo,
  Quote,
  UntickEmptyRows,
  inList,
  liftPhotos,
  photoIdOf,
  shiftIndent,
  shiftInList,
} from "./extensions";
import { fitWords, type WordKind } from "../src/editor/wordFit";
import { fitsNow, insertionFor, typedSince } from "../src/editor/wordOffer";
import bold from "./fonts/NunitoSans-Bold.woff2";
import italic from "./fonts/NunitoSans-Italic.woff2";
import regular from "./fonts/NunitoSans-Regular.woff2";
import semibold from "./fonts/NunitoSans-SemiBold.woff2";

// When a change goes to the app: once typing pauses this long, and at least
// this often while it doesn't. Each send is the whole note, twice over (its
// Markdown and its rich text).
const CHANGE_PAUSE_MS = 250;
const CHANGE_MAX_WAIT_MS = 1_000;
// How much of the note either side of the cursor word help gets.
const BEFORE_CHARS = 600;
const AFTER_CHARS = 40;
// The cursor is reported once it rests, not on every key.
const CURSOR_MS = 120;

type Bridge = { postMessage: (data: string) => void };
// Opened on its own (no app around it), what would have gone to the app is kept here.
const sent: FromPage[] = [];
(window as unknown as { __editorSent: FromPage[] }).__editorSent = sent;

/** To the app: react-native-webview's bridge on the phone, the parent page in the web build (an iframe). */
function send(message: FromPage) {
  const text = JSON.stringify(message);
  const bridge = (window as unknown as { ReactNativeWebView?: Bridge }).ReactNativeWebView;
  if (bridge) bridge.postMessage(text);
  else if (window.parent !== window) window.parent.postMessage({ sageEditor: text }, "*");
  else sent.push(message);
}

window.addEventListener("error", (event) => send({ type: "error", message: String(event.message || event.error) }));
window.addEventListener("unhandledrejection", (event) => send({ type: "error", message: String(event.reason) }));

// ---- The look ----------------------------------------------------------

let look: EditorLook = {
  placeholder: "",
  colors: {
    card: "#FFFFFF",
    ink: "#1F1D1A",
    ink2: "#57524B",
    ink3: "#6F6A62",
    line: "#E1DDD5",
    sunken: "#F4F2EE",
    accent: "#47775B",
    onAccent: "#FFFFFF",
    accentText: "#47775B",
  },
  body: { size: 17, lineHeight: 27 },
  question: { size: 18, lineHeight: 25 },
  padding: { top: 8, side: 20, bottom: 54 },
};

// Sage's face, set up once and loaded at once. Kept apart from the look,
// which comes again as the app sends it: rewriting these rules with it made
// the fonts load again, so the words could first show in another face.
const faces = document.createElement("style");
faces.textContent = [
  [regular, 400, "normal"],
  [italic, 400, "italic"],
  [semibold, 600, "normal"],
  [bold, 700, "normal"],
]
  .map(([url, weight, fontStyle]) => `@font-face { font-family: "Sage"; src: url("${url}") format("woff2"); font-weight: ${weight}; font-style: ${fontStyle}; }`)
  .join("\n");
document.head.appendChild(faces);
const facesReady: Promise<unknown> = document.fonts
  ? Promise.all(["400 17px Sage", "italic 400 17px Sage", "600 17px Sage", "700 17px Sage"].map((font) => document.fonts.load(font))).catch(() => undefined)
  : Promise.resolve();

const style = document.createElement("style");
document.head.appendChild(style);

/** Sage's check, as in CircleCheck: a faint hint when open, white on the accent when ticked. */
function check(stroke: string, width: number, opacity = 1): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'><path d='M8.2 14.4l3.6 3.6 7.6-8' fill='none' stroke='${stroke}' stroke-opacity='${opacity}' stroke-width='${width}' stroke-linecap='round' stroke-linejoin='round'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** A photo's outline (Lucide's image), where a photo isn't on this phone. */
function photoGlyph(stroke: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='${stroke}' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'><rect width='18' height='18' x='3' y='3' rx='2' ry='2'/><circle cx='9' cy='9' r='2'/><path d='m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function applyLook(next: EditorLook) {
  look = next;
  const { colors: c, body, question: q, padding: p } = next;
  style.textContent = `
    html, body { margin: 0; padding: 0; background: ${c.card}; -webkit-text-size-adjust: 100%; }
    body { -webkit-tap-highlight-color: transparent; }
    .ProseMirror {
      outline: none; box-sizing: border-box; min-height: 100vh;
      padding: ${p.top}px ${p.side}px calc(${p.bottom}px + var(--inset, 0px));
      font-family: "Sage", -apple-system, system-ui, sans-serif;
      font-size: ${body.size}px; line-height: ${body.lineHeight}px;
      color: ${c.ink}; caret-color: ${c.accent};
      word-wrap: break-word; white-space: pre-wrap;
      -webkit-user-select: text; user-select: text;
    }
    .ProseMirror ::selection { background: ${c.accent}33; }
    .ProseMirror p { margin: 0; }
    ${Array.from({ length: MAX_INDENT }, (_, i) => `.ProseMirror [data-indent="${i + 1}"] { margin-left: ${1.6 * (i + 1)}em; }`).join("\n    ")}
    .ProseMirror h1, .ProseMirror h2, .ProseMirror h3 { font-weight: 700; line-height: 1.3; margin: 14px 0 4px; }
    .ProseMirror h1 { font-size: 1.45em; }
    .ProseMirror h2 { font-size: 1.25em; }
    .ProseMirror h3 { font-size: 1.1em; }
    .ProseMirror strong { font-weight: 700; }
    .ProseMirror ul, .ProseMirror ol { margin: 0; padding-left: 1.45em; }
    .ProseMirror li::marker { color: ${c.ink2}; }
    .ProseMirror li > p { margin: 0; }
    .ProseMirror ul[data-type="taskList"] { list-style: none; padding-left: 0.1em; }
    .ProseMirror ul[data-type="taskList"] li { display: flex; gap: 12px; align-items: flex-start; }
    /* The check sits in a box exactly one line tall, so a checklist row is as
       tall as any other line and nothing moves when it changes. */
    .ProseMirror ul[data-type="taskList"] li > label {
      flex: 0 0 auto; display: flex; align-items: center; height: ${body.lineHeight}px; margin: 0;
    }
    .ProseMirror ul[data-type="taskList"] li > div { flex: 1; min-width: 0; }
    .ProseMirror ul[data-type="taskList"] li > div {
      text-decoration: line-through; text-decoration-color: transparent;
      transition: color 220ms cubic-bezier(0.16, 1, 0.3, 1), text-decoration-color 220ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    .ProseMirror ul[data-type="taskList"] li[data-checked="true"] > div { color: ${c.ink3}; text-decoration-color: ${c.ink3}; }
    /* A question or a photo added comes down into place. */
    .ProseMirror blockquote.arriving, .ProseMirror .photo.arriving { animation: sage-arrive 300ms cubic-bezier(0.16, 1, 0.3, 1); }
    @keyframes sage-arrive { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) {
      .ProseMirror blockquote.arriving, .ProseMirror .photo.arriving { animation-name: sage-fade; }
      @keyframes sage-fade { from { opacity: 0; } to { opacity: 1; } }
    }
    .ProseMirror ul[data-type="taskList"] input {
      -webkit-appearance: none; appearance: none; box-sizing: border-box;
      width: 24px; height: 24px; margin: 0; border-radius: 50%;
      border: 1.75px solid ${c.ink2}; background: ${check(c.ink3, 1.75, 0.55)} center / 100% 100% no-repeat;
      background-origin: border-box;
      transition: background-color 180ms cubic-bezier(0.23, 1, 0.32, 1), border-color 180ms cubic-bezier(0.23, 1, 0.32, 1), transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
    }
    .ProseMirror ul[data-type="taskList"] input:checked { background-color: ${c.accent}; border-color: ${c.accent}; background-image: ${check(c.onAccent, 2.6)}; }
    .ProseMirror ul[data-type="taskList"] input:active { transform: scale(0.9); }
    /* A quote is a question, standing in the accent as Sage's questions do. */
    .ProseMirror blockquote {
      margin: 12px 0 4px; padding-left: 16px; border-left: 3px solid ${c.accent};
      color: ${c.accentText}; font-weight: 600; font-size: ${q.size}px; line-height: ${q.lineHeight}px;
    }
    .ProseMirror > blockquote:first-child { margin-top: 0; }
    .ProseMirror blockquote p { margin: 0; }
    .ProseMirror a { color: ${c.accentText}; text-decoration: underline; text-underline-offset: 2px; }
    .ProseMirror code { background: ${c.sunken}; border-radius: 4px; padding: 1px 4px; font-size: 0.9em; }
    /* A photo: the words' width, held at its shape on the sunken colour until it's drawn, so nothing moves when it is. */
    .ProseMirror .photo {
      position: relative; margin: 10px 0; border-radius: 14px; overflow: hidden;
      background: ${c.sunken}; aspect-ratio: 4 / 3;
      -webkit-touch-callout: none; -webkit-user-select: none; user-select: none;
    }
    .ProseMirror .photo img {
      display: block; width: 100%; height: 100%; object-fit: contain; opacity: 0; pointer-events: none;
      -webkit-user-drag: none; transition: opacity 220ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    .ProseMirror .photo.drawn img { opacity: 1; }
    @media (prefers-reduced-motion: reduce) { .ProseMirror .photo img { transition: none; } }
    .ProseMirror .photo.missing { background: ${c.sunken} ${photoGlyph(c.ink3)} center / 36px 36px no-repeat; }
    /* Chosen (Backspace takes it next), while writing: a note that starts with a photo doesn't open outlined. */
    .ProseMirror.ProseMirror-focused .photo.ProseMirror-selectednode { outline: 3px solid ${c.accent}; outline-offset: 2px; }
    .ProseMirror p.is-editor-empty:first-child::before,
    .ProseMirror blockquote + p.is-empty::before {
      content: attr(data-placeholder); color: ${c.ink3}; float: left; height: 0; pointer-events: none;
    }
  `;
}
applyLook(look);

// ---- Photos ------------------------------------------------------------------

/**
 * A note's photos are files kept on the phone (the note only names them, see
 * extensions.ts), so the page asks the app for each one it shows. What it's
 * told is kept for the page's life: where to show the photo from, or null
 * when this phone doesn't have it.
 */
const photoSources = new Map<string, string | null>();
// The photos on the page, by id (a photo can be in a note twice).
const photoViews = new Map<string, Set<PhotoView>>();
// Asked about and not answered yet; asked for together, in one message.
const photosAsked = new Set<string>();
let photosToAsk: string[] = [];
// Photos not drawn yet (nor known to be missing): the note is "shown" once they are, or after a moment.
let photosBusy = 0;
let whenPhotosDrawn: (() => void)[] = [];

function askForPhoto(id: string) {
  if (photosAsked.has(id)) return;
  photosAsked.add(id);
  photosToAsk.push(id);
  if (photosToAsk.length > 1) return;
  queueMicrotask(() => {
    const ids = photosToAsk;
    photosToAsk = [];
    send({ type: "needPhotos", ids });
  });
}

/** The app's answer: where each photo can be shown from, or null. */
function takePhotos(sources: Record<string, string | null>) {
  for (const [id, src] of Object.entries(sources)) {
    photoSources.set(id, typeof src === "string" && src ? src : null);
    photosAsked.delete(id);
    for (const view of photoViews.get(id) ?? []) view.show();
  }
}

/** Settles once every photo on the page is drawn, or known not to be on the phone. */
function photosDrawn(): Promise<void> {
  return photosBusy === 0 ? Promise.resolve() : new Promise((resolve) => whenPhotosDrawn.push(resolve));
}

// A tall photo is shown no taller than 3:5, whole, on the sunken colour: it never fills the screen.
const TALLEST = 3 / 5;
/** A photo's shape (width over height), from its size, if it's known. */
function shapeOf(width: unknown, height: unknown): number | null {
  const w = Number(width);
  const h = Number(height);
  return w > 0 && h > 0 ? Math.max(w / h, TALLEST) : null;
}

/**
 * A photo on the page. It holds its shape from the start (its size, when the
 * note has it), asks the app where to load it from, and fades in once drawn.
 * One the phone doesn't have, or an image from anywhere else, shows as a
 * quiet outline instead.
 */
class PhotoView {
  dom: HTMLElement;
  private img: HTMLImageElement;
  private node: ProseMirrorNode;
  private id: string | null = null;
  private busy = false;

  constructor(node: ProseMirrorNode) {
    this.node = node;
    this.dom = document.createElement("div");
    this.dom.className = "photo";
    this.dom.setAttribute("role", "img");
    this.img = document.createElement("img");
    this.img.alt = "";
    this.img.draggable = false;
    this.dom.appendChild(this.img);
    this.take(node);
  }

  private take(node: ProseMirrorNode) {
    this.node = node;
    this.dom.setAttribute("aria-label", (node.attrs.alt as string | null) || "Photo");
    const shape = shapeOf(node.attrs.width, node.attrs.height);
    if (shape) this.dom.style.aspectRatio = String(shape);
    const id = photoIdOf(node.attrs.src);
    if (id !== this.id) {
      this.leave();
      this.id = id;
      if (id) {
        if (!photoViews.has(id)) photoViews.set(id, new Set());
        photoViews.get(id)?.add(this);
      }
    }
    this.show();
  }

  /** Drawn once the app has said where the photo is; asked for until then. */
  show() {
    const src = this.id ? photoSources.get(this.id) : null;
    if (src === undefined) {
      this.setBusy(true);
      askForPhoto(this.id as string);
      return;
    }
    if (src === null) {
      this.missing();
      return;
    }
    if (this.img.getAttribute("src") === src) return;
    this.setBusy(true);
    this.dom.classList.remove("missing");
    this.img.onload = () => {
      if (!shapeOf(this.node.attrs.width, this.node.attrs.height)) {
        this.dom.style.aspectRatio = String(shapeOf(this.img.naturalWidth, this.img.naturalHeight) ?? "");
      }
      this.dom.classList.add("drawn");
      this.setBusy(false);
    };
    this.img.onerror = () => this.missing();
    this.img.src = src;
  }

  private missing() {
    this.img.onload = null;
    this.img.onerror = null;
    this.img.removeAttribute("src");
    this.dom.classList.remove("drawn");
    this.dom.classList.add("missing");
    this.setBusy(false);
  }

  private setBusy(busy: boolean) {
    if (busy === this.busy) return;
    this.busy = busy;
    photosBusy += busy ? 1 : -1;
    if (photosBusy === 0) for (const resolve of whenPhotosDrawn.splice(0)) resolve();
  }

  private leave() {
    if (this.id) photoViews.get(this.id)?.delete(this);
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;
    const { src, alt, width, height } = this.node.attrs;
    if (node.attrs.src !== src || node.attrs.alt !== alt || node.attrs.width !== width || node.attrs.height !== height) this.take(node);
    else this.node = node;
    return true;
  }

  destroy() {
    this.leave();
    this.setBusy(false);
  }
}

// Photos, drawn by the page (PhotoView).
const SagePhoto = Photo.extend({ addNodeView: () => ({ node }) => new PhotoView(node) });

// ---- The editor ------------------------------------------------------------

/** The page's own words where it's empty; "Write" under a question. */
function placeholderFor({ editor: current, pos }: { editor: Editor; pos: number }): string {
  const $pos = current.state.doc.resolve(pos);
  const before = $pos.depth === 0 && $pos.index() > 0 ? $pos.parent.child($pos.index() - 1) : null;
  return before?.type.name === "blockquote" ? "Write" : look.placeholder;
}

const editor = new Editor({
  element: document.getElementById("editor") as HTMLElement,
  extensions: [
    StarterKit.configure({ paragraph: false, blockquote: false, heading: { levels: [1, 2, 3] }, hardBreak: false, link: false }),
    Quote,
    IndentedParagraph,
    Indent,
    LineStartBackspace,
    UntickEmptyRows,
    LineBreak,
    NoteLink.configure({ openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: "https" }),
    SagePhoto,
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder: placeholderFor }),
    Markdown.configure({ markedOptions: { breaks: true, gfm: true } }),
  ],
  content: "",
  contentType: "markdown",
  editorProps: {
    attributes: { autocapitalize: "sentences", autocorrect: "on", spellcheck: "true" },
    // Typing, the line stays in sight the page's way: clear of whatever covers its bottom.
    handleScrollToSelection: () => {
      keepCaretClear(false);
      return true;
    },
  },
  // Changes go over in batches (see CHANGE_PAUSE_MS). Leaving the note must
  // never lose the last words typed: the keyboard closing, the page being
  // hidden and the app asking all send what is waiting at once.
  // Each is handed the editor: the first fire while it is still being made.
  onUpdate: ({ editor: current }) => {
    scheduleChange(current);
    reportCursor(current);
  },
  onSelectionUpdate: ({ editor: current }) => reportCursor(current),
  onTransaction: ({ editor: current }) => reportFormats(current),
  onFocus: ({ editor: current }) => {
    send({ type: "focus", focused: true });
    reportCursor(current);
  },
  onBlur: ({ editor: current }) => {
    flushChange(current);
    send({ type: "focus", focused: false });
  },
});

// ---- What goes to the app ---------------------------------------------------

let changeTimer: ReturnType<typeof setTimeout> | null = null;
let changeSince = 0;

function sendChange(current: Editor) {
  if (changeTimer) clearTimeout(changeTimer);
  changeTimer = null;
  // Lists leave empty lines at the end; they are not the writer's.
  const markdown = current.getMarkdown().replace(/\n+$/, "");
  send({ type: "change", markdown, doc: current.getJSON(), at: Date.now() });
}

function scheduleChange(current: Editor) {
  const now = Date.now();
  if (changeTimer) clearTimeout(changeTimer);
  else changeSince = now;
  const wait = Math.max(0, Math.min(CHANGE_PAUSE_MS, changeSince + CHANGE_MAX_WAIT_MS - now));
  changeTimer = setTimeout(() => sendChange(current), wait);
}

function flushChange(current: Editor) {
  if (changeTimer) sendChange(current);
}

// The page hidden (the app going to the background, or closing): what is
// waiting goes now, while it still can.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushChange(editor);
});
window.addEventListener("pagehide", () => flushChange(editor));

// Points at the bottom covered by something over the page (word help's strip):
// the line being written stays above it, and the words can scroll up past it.
let bottomInset = 0;
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
/**
 * The line being written stays in sight: above the bottom (and whatever covers
 * it) and below the top, with a little room. `smooth` glides there (a new
 * question, the strip arriving) instead of jumping.
 */
function keepCaretClear(smooth: boolean) {
  if (!editor.isFocused) return;
  let at: { top: number; bottom: number };
  try {
    at = editor.view.coordsAtPos(editor.state.selection.head);
  } catch {
    return;
  }
  const room = 12;
  const bottom = window.innerHeight - bottomInset - room;
  const by = at.bottom > bottom ? at.bottom - bottom : at.top < room ? at.top - room : 0;
  if (by) window.scrollBy({ top: by, behavior: smooth && !reducedMotion() ? "smooth" : "auto" });
}

// Less room for the words (the keyboard rising): the line being written stays in sight.
window.addEventListener("resize", () => keepCaretClear(false));

// A checklist row ticked by a tap: its check gives a little pop, and the app
// is told, for the haptic. The pop is an animation, not a class: the editor
// puts back any change to its own markup.
// Heard before the row's own handler (capture), since that redraws the row:
// where it is now, so the redrawn row can be found once it's there.
editor.view.dom.addEventListener(
  "change",
  (event) => {
    const box = event.target as HTMLInputElement | null;
    if (!box || box.type !== "checkbox") return;
    const on = box.checked;
    // Which row it is, by its place among the checklist rows: a redraw doesn't change that.
    const rows = () => [...editor.view.dom.querySelectorAll('ul[data-type="taskList"] li')];
    const index = rows().indexOf(box.closest("li") as Element);
    requestAnimationFrame(() => {
      const check = index >= 0 ? rows()[index]?.querySelector("input") : null;
      if (!on || !check || reducedMotion()) return;
      check.animate([{ transform: "scale(0.82)" }, { transform: "scale(1.08)", offset: 0.6 }, { transform: "scale(1)" }], { duration: 420, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
    });
    send({ type: "ticked", on });
  },
  true,
);

let cursorTimer: ReturnType<typeof setTimeout> | null = null;
let lastCursor = "";
function cursorOf(current: Editor): EditorCursor {
  const { doc, selection } = current.state;
  const at = selection.from;
  return {
    before: doc.textBetween(Math.max(0, at - BEFORE_CHARS), at, "\n", " "),
    after: doc.textBetween(at, Math.min(doc.content.size, at + AFTER_CHARS), "\n", " "),
  };
}
function reportCursor(current: Editor) {
  if (cursorTimer) clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => {
    const cursor = cursorOf(current);
    const key = JSON.stringify(cursor);
    if (key === lastCursor) return;
    lastCursor = key;
    send({ type: "cursor", cursor });
  }, CURSOR_MS);
}

let lastFormats = "";
function formatsOf(current: Editor): EditorFormats {
  return {
    bold: current.isActive("bold"),
    italic: current.isActive("italic"),
    strike: current.isActive("strike"),
    heading: current.isActive("heading"),
    quote: current.isActive("blockquote"),
    bullet: current.isActive("bulletList"),
    ordered: current.isActive("orderedList"),
    task: current.isActive("taskList"),
    link: current.isActive("link") ? ((current.getAttributes("link").href as string | undefined) ?? "") : null,
    selection: !current.state.selection.empty,
  };
}
function reportFormats(current: Editor) {
  const formats = formatsOf(current);
  const key = JSON.stringify(formats);
  if (key === lastFormats) return;
  lastFormats = key;
  send({ type: "formats", formats });
}

// ---- What comes from the app ------------------------------------------------

/** Text in at the cursor; `trimBefore` takes the spaces before it out first (a full stop goes there). */
function insertAtCursor(text: string, trimBefore: boolean) {
  const at = editor.state.selection.from;
  const before = editor.state.doc.textBetween(Math.max(0, at - 40), at, "\n", " ");
  const spaces = trimBefore ? before.length - before.trimEnd().length : 0;
  let next = editor.chain().focus();
  if (spaces > 0) next = next.deleteRange({ from: at - spaces, to: at });
  next.insertContent({ type: "text", text }).run();
}

let seedNow = "boot";
// A note has been put on the page once: later copies cross-fade in.
let hasShown = false;

/** The note's text, once the app sends it, and any new copy of it later (the server's, a restored draft). */
function takeSeed(message: Extract<ToPage, { type: "seed" }>) {
  if (message.seed === seedNow) return;
  seedNow = message.seed;
  // Words typed here and not yet sent are newer than any copy the app has:
  // they stay, and go over now.
  if (changeTimer) {
    sendChange(editor);
    send({ type: "shown", seed: message.seed });
    return;
  }
  // The rich text when the note has it; its Markdown otherwise (notes from
  // before rich text, or edited as plain text since). Either way, each photo
  // on a line of its own (liftPhotos).
  const put = () => {
    const doc = message.doc as { type?: unknown } | null;
    const rich = doc && typeof doc === "object" && doc.type === "doc" ? (doc as JSONContent) : null;
    const content = rich ?? editor.markdown?.parse(message.markdown);
    if (content) editor.commands.setContent(liftPhotos(content), { emitUpdate: false });
    else editor.commands.setContent(message.markdown, { contentType: "markdown", emitUpdate: false });
    if (message.focus === "end") editor.commands.focus("end");
    reportFormats(editor);
  };
  // A later copy (another question in its place, none, a newer copy from the
  // server): the words cross-fade rather than change in one frame.
  if (hasShown && !reducedMotion()) {
    const page = editor.view.dom;
    page.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 110, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" }).onfinish = () => {
      // Typed into while it dimmed: those words are newer than this copy, and stay.
      if (changeTimer) sendChange(editor);
      else put();
      page.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" });
    };
    send({ type: "shown", seed: message.seed });
    return;
  }
  put();
  hasShown = true;
  shownOnceDrawn(message.seed);
}

/**
 * "Shown" once the words are really on screen: Sage's face loaded, the
 * note's photos drawn (or known not to be on the phone), and the page drawn
 * (two frames), so the app's fade-in never starts on a blank or half-drawn
 * page. If any of it is slow to come (a page out of sight), it's said anyway
 * after a moment.
 */
function shownOnceDrawn(seed: string) {
  let said = false;
  const say = () => {
    if (said) return;
    said = true;
    send({ type: "shown", seed });
  };
  void Promise.all([facesReady, photosDrawn()]).then(() => requestAnimationFrame(() => requestAnimationFrame(say)));
  setTimeout(say, 400);
}

/**
 * Where a block goes: after the line the cursor is in (in place of it, if
 * it's an empty line), or at the end of the note (in place of an empty last
 * line). Between blocks, or with a photo chosen, it goes right there.
 */
function placeFor(atEnd: boolean): { from: number; to: number } {
  const { doc, selection } = editor.state;
  if (atEnd) {
    const last = doc.lastChild;
    const lastEmpty = last?.type.name === "paragraph" && last.content.size === 0;
    return { from: lastEmpty && last ? doc.content.size - last.nodeSize : doc.content.size, to: doc.content.size };
  }
  if (selection.$from.depth === 0 && (selection instanceof NodeSelection || selection.empty)) {
    const at = selection instanceof NodeSelection ? selection.to : selection.from;
    return { from: at, to: at };
  }
  const index = selection.$from.index(0);
  let start = 0;
  for (let i = 0; i < index; i++) start += doc.child(i).nodeSize;
  const block = doc.child(index);
  const empty = block.type.name === "paragraph" && block.content.size === 0;
  return empty ? { from: start, to: start + block.nodeSize } : { from: start + block.nodeSize, to: start + block.nodeSize };
}

/**
 * A block put in at `place`, with an empty line under it and the cursor
 * there. It comes down into place (a little rise as it fades in), and the
 * page glides to the empty line rather than jumping there.
 */
function putWithLineUnder(block: ProseMirrorNode, { from, to }: { from: number; to: number }) {
  const tr = editor.state.tr.replaceWith(from, to, [block, editor.schema.nodes.paragraph.create()]);
  tr.setSelection(TextSelection.create(tr.doc, from + block.nodeSize + 1));
  editor.view.dispatch(tr);
  const added = editor.view.nodeDOM(from);
  if (added instanceof HTMLElement) {
    added.classList.add("arriving");
    added.addEventListener("animationend", () => added.classList.remove("arriving"), { once: true });
  }
  editor.commands.focus(null, { scrollIntoView: false });
  requestAnimationFrame(() => keepCaretClear(true));
}

/**
 * A question: a quote, with an empty line under it for the answer and the
 * cursor there. At the cursor it goes after the line the cursor is in (an
 * empty line becomes the question); `atEnd` puts it at the end of the note.
 */
function insertQuestion(text: string, atEnd: boolean) {
  const { schema } = editor;
  const quote = schema.nodes.blockquote.create(null, schema.nodes.paragraph.create(null, schema.text(text)));
  putWithLineUnder(quote, placeFor(atEnd));
}

/**
 * A photo kept on the phone, on a line of its own after the one the cursor
 * is in (an empty line becomes the photo), with an empty line under it for
 * the cursor. Its size holds its shape until it's drawn.
 */
function insertPhoto(id: string, width?: number, height?: number) {
  const size = (value?: number) => (typeof value === "number" && value > 0 ? Math.round(value) : null);
  const photo = editor.schema.nodes.image.create({ src: PHOTO_PREFIX + id, width: size(width), height: size(height) });
  putWithLineUnder(photo, placeFor(false));
}

function run(name: EditorCommand, value?: string) {
  if (name === "flush") {
    flushChange(editor);
    return;
  }
  const chain = () => editor.chain().focus();
  switch (name) {
    case "bold":
      chain().toggleBold().run();
      break;
    case "italic":
      chain().toggleItalic().run();
      break;
    case "strike":
      chain().toggleStrike().run();
      break;
    case "heading":
      chain().toggleHeading({ level: 2 }).run();
      break;
    case "quote":
      chain().toggleBlockquote().run();
      break;
    case "bullet":
      chain().toggleBulletList().run();
      break;
    case "ordered":
      chain().toggleOrderedList().run();
      break;
    case "task":
      chain().toggleTaskList().run();
      break;
    // In a list, an item nests under the one before it (or comes back out);
    // anywhere else the line itself moves in or out.
    case "indent":
    case "outdent": {
      const delta = name === "indent" ? 1 : -1;
      if (inList(editor)) shiftInList(editor, delta);
      else shiftIndent(editor, delta);
      editor.commands.focus();
      break;
    }
    case "link": {
      const href = (value ?? "").trim();
      if (!href) {
        chain().extendMarkRange("link").unsetLink().run();
      } else if (editor.state.selection.empty && !editor.isActive("link")) {
        chain()
          .insertContent([
            { type: "text", text: href, marks: [{ type: "link", attrs: { href } }] },
            { type: "text", text: " " },
          ])
          .run();
      } else {
        chain().extendMarkRange("link").setLink({ href }).run();
      }
      break;
    }
    // A suggestion: words at the cursor. `value` is JSON: the text, and
    // whether to drop the spaces before the cursor first.
    case "insertText": {
      const { text, trimBefore } = JSON.parse(value ?? "{}") as { text: string; trimBefore?: boolean };
      if (text) insertAtCursor(text, Boolean(trimBefore));
      break;
    }
    case "insertWords": {
      const { text, kind, anchor } = JSON.parse(value ?? "{}") as { text?: string; kind?: WordKind; anchor?: string };
      if (!text || (kind !== "finish" && kind !== "start")) break;
      const { before, after } = cursorOf(editor);
      const typed = typedSince(anchor ?? before, before);
      // Typed out already, in the moment before the tap: nothing more goes in.
      if (!(typed !== null && typed.trim().toLowerCase().endsWith(text.toLowerCase()))) {
        const idea = { text, kind, source: "ai" as const };
        const fits = fitsNow({ id: 0, anchor: anchor ?? before, finishes: kind === "finish" ? [idea] : [], starts: kind === "start" ? [idea] : [] }, before);
        const fit = fits ? [...fits.finishes, ...fits.starts][0] : undefined;
        // Begun: only the rest. Otherwise all of it, cased and spaced for where the cursor is.
        const put = fit ? insertionFor(fit, before, after) : fitWords(text, kind, before, after);
        insertAtCursor(put.text, put.trimBefore);
        send({ type: "inserted", before: cursorOf(editor).before, length: put.text.length });
      } else {
        send({ type: "inserted", before, length: 0 });
      }
      break;
    }
    // `value` is JSON: the question, and whether it goes at the end.
    case "insertQuestion": {
      const { text, atEnd } = JSON.parse(value ?? "{}") as { text?: string; atEnd?: boolean };
      if (text) insertQuestion(text, Boolean(atEnd));
      break;
    }
    // `value` is JSON: the photo's id, and its size.
    case "insertPhoto": {
      const { id, width, height } = JSON.parse(value ?? "{}") as { id?: string; width?: number; height?: number };
      if (id) insertPhoto(id, width, height);
      break;
    }
    // With the suggestion strip in the keyboard's place, a tap moves the
    // cursor and brings no keyboard.
    case "tray":
      editor.view.dom.setAttribute("inputmode", value === "on" ? "none" : "text");
      if (value === "on") editor.commands.blur();
      break;
    // Back to typing here. Text focused while the strip was open has no
    // keyboard; it has to let go and take focus again for one to come.
    case "keyboard":
      editor.view.dom.setAttribute("inputmode", "text");
      editor.commands.blur();
      setTimeout(() => editor.commands.focus(), 50);
      break;
    case "focus":
      editor.commands.focus();
      break;
    case "inset": {
      const next = Math.max(0, Number(value) || 0);
      const more = next > bottomInset;
      bottomInset = next;
      document.documentElement.style.setProperty("--inset", `${next}px`);
      if (more) keepCaretClear(true);
      break;
    }
    case "blur":
      editor.commands.blur();
      break;
  }
}

(window as unknown as Record<string, unknown>)[PAGE_RECEIVER] = {
  receive(message: ToPage) {
    if (message.type === "look") applyLook(message.look);
    else if (message.type === "seed") takeSeed(message);
    else if (message.type === "photos") takePhotos(message.sources);
    else run(message.name, message.value);
  },
};

send({ type: "ready" });
