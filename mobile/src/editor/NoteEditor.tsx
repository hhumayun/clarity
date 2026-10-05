"use dom";

import Blockquote from "@tiptap/extension-blockquote";
import HardBreak from "@tiptap/extension-hard-break";
import Link from "@tiptap/extension-link";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import Paragraph from "@tiptap/extension-paragraph";
import { Extension } from "@tiptap/core";
import { Plugin, Selection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import type { Node as ProseMirrorNode, ResolvedPos } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Asset } from "expo-asset";
import { useDOMImperativeHandle, type DOMImperativeFactory, type DOMProps } from "expo/dom";
import React, { useEffect, useMemo, useRef } from "react";
import { kbOf, perfClock, perfCount, perfMark, perfNow, perfRecord, perfSide } from "../lib/perf";

// This page's lines in the timing log.
perfSide("editor");

/** The formats where the cursor is, for the toolbar. */
export type NoteEditorState = {
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

/** The words either side of the cursor, as plain text, for the AI suggestions. */
export type NoteCursor = { before: string; after: string };

/** What the app asks of the editor: `run("bold")`, `run("link", url)`… */
export interface NoteEditorHandle extends DOMImperativeFactory {
  run: (...args: unknown[]) => void;
}

type Props = {
  ref?: React.Ref<NoteEditorHandle>;
  /**
   * The note, taken in whenever `seed` changes: its rich text (`doc`) when it
   * has one, else its Markdown. While `seed` is "boot" there is no text yet:
   * the app sends it once the page is up (see BootedNoteEditor on the note
   * page).
   */
  markdown: string;
  doc: unknown;
  seed: string;
  placeholder: string;
  autoFocus: boolean;
  palette: { text: string; muted: string; accent: string; border: string; surface: string };
  fontSize: number;
  lineHeight: number;
  /**
   * The note as it now stands: its Markdown (for search, the AI, previews)
   * and its rich text, together, and when they left here (the phone's clock).
   * Sent once typing pauses, and at least every second while it doesn't; at
   * once when the keyboard closes, the page is hidden, or the app asks
   * (`run("flush")`, as the note is left).
   */
  onChange: (markdown: string, doc: JSONContent, sentAt: number) => Promise<void>;
  onCursor: (cursor: NoteCursor) => Promise<void>;
  onState: (state: NoteEditorState, sentAt: number) => Promise<void>;
  onFocusChange: (focused: boolean) => Promise<void>;
  onReady: () => Promise<void>;
  dom?: DOMProps;
};

// When a change goes to the app: once typing pauses this long, and at least
// this often while it doesn't. Each send is the whole note, twice over (its
// Markdown and its rich text), and the app redraws the page for it.
const CHANGE_PAUSE_MS = 250;
const CHANGE_MAX_WAIT_MS = 1_000;

// How much of the note either side of the cursor the suggestions get.
const BEFORE_CHARS = 600;
const AFTER_CHARS = 40;
// The cursor is reported once it rests, not on every key.
const CURSOR_MS = 120;

// A line break is kept as a plain new line, and read back as one (marked's
// `breaks`), so the note's text stays readable anywhere it is shown as
// plain text, and notes written before rich text keep their lines.
const LineBreak = HardBreak.extend({ renderMarkdown: () => "\n" });

// An indent, up to six steps, on a paragraph, a heading or a whole list. The
// rich text keeps it as a level. Its Markdown keeps a paragraph's as four
// non-breaking spaces a step at the start of the line: they survive the
// Markdown reader (it trims only ordinary spaces) and read as the indent they
// are wherever the note is shown as plain text. A heading's or a list's lives
// in the rich text only.
const NBSP = "\u00a0";
const INDENT_UNIT = 4;
const MAX_INDENT = 6;
type InlineToken = { type: string; raw?: string; text?: string };

/** The indent at the start of a paragraph's words in Markdown, taken off them. */
function takeIndent(tokens: InlineToken[]): { level: number; tokens: InlineToken[] } {
  const first = tokens[0];
  if (!first || first.type !== "text" || typeof first.text !== "string") return { level: 0, tokens };
  const run = first.text.length - first.text.replace(/^\u00a0+/, "").length;
  const level = Math.min(MAX_INDENT, Math.floor(run / INDENT_UNIT));
  if (level === 0) return { level, tokens };
  const strip = (value?: string) => (value ?? "").slice(level * INDENT_UNIT);
  const rest = { ...first, text: strip(first.text), raw: strip(first.raw) };
  return { level, tokens: rest.text ? [rest, ...tokens.slice(1)] : tokens.slice(1) };
}

const LISTS = ["bulletList", "orderedList", "taskList"];
const clampIndent = (value: number) => Math.max(0, Math.min(MAX_INDENT, value));

/** The indent level, on the blocks that can have one. */
const Indent = Extension.create({
  name: "indent",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading", ...LISTS],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => clampIndent(Number(element.getAttribute("data-indent")) || 0),
            renderHTML: (attributes) => (attributes.indent ? { "data-indent": String(attributes.indent) } : {}),
          },
        },
      },
    ];
  },
});

/** One step in or out for every paragraph and heading in the selection. */
function shiftIndent(editor: Editor, delta: number): boolean {
  const { state, view } = editor;
  const { from, to } = state.selection;
  const tr = state.tr;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== "paragraph" && node.type.name !== "heading") return true;
    const indent = clampIndent(((node.attrs.indent as number) ?? 0) + delta);
    if (indent !== node.attrs.indent) tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent });
    return false;
  });
  if (!tr.docChanged) return false;
  view.dispatch(tr);
  return true;
}

const inList = (editor: Editor) => editor.isActive("listItem") || editor.isActive("taskItem");

/** The list the cursor is in, nearest first, and whether it sits inside another. */
function listAtCursor(editor: Editor) {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (LISTS.includes(node.type.name)) {
      const parent = depth > 1 ? $from.node(depth - 1).type.name : "doc";
      return { node, pos: $from.before(depth), nested: parent === "listItem" || parent === "taskItem" };
    }
  }
  return null;
}

/** One step in or out for a whole list. */
function shiftList(editor: Editor, delta: number): boolean {
  const list = listAtCursor(editor);
  if (!list) return false;
  const indent = clampIndent(((list.node.attrs.indent as number) ?? 0) + delta);
  if (indent === list.node.attrs.indent) return false;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(list.pos, undefined, { ...list.node.attrs, indent }));
  return true;
}

/**
 * Indent in a list: an item nests under the one before it; the first item,
 * with none before it, takes the whole list in. Outdent undoes it the same
 * way: a list that was moved in comes back first, then items lift out.
 */
function shiftInList(editor: Editor, delta: number) {
  const item = editor.isActive("taskItem") ? "taskItem" : "listItem";
  if (delta > 0) {
    if (!editor.chain().focus().sinkListItem(item).run()) shiftList(editor, 1);
    return;
  }
  const list = listAtCursor(editor);
  if (list && !list.nested && ((list.node.attrs.indent as number) ?? 0) > 0) shiftList(editor, -1);
  else editor.chain().focus().liftListItem(item).run();
}

const IndentedParagraph = Paragraph.extend({
  parseMarkdown(token, helpers) {
    const { level, tokens } = takeIndent((token.tokens ?? []) as InlineToken[]);
    const node = Paragraph.config.parseMarkdown?.call(this, { ...token, tokens } as typeof token, helpers);
    if (level && node && !Array.isArray(node)) node.attrs = { ...(node.attrs ?? {}), indent: level };
    return node ?? [];
  },
  renderMarkdown(node, helpers, context) {
    // An empty line is simply empty: no "&nbsp;" marker in the Markdown,
    // which is read as plain text elsewhere. (The rich text keeps it.)
    if (!node.content?.length) return "";
    const text = Paragraph.config.renderMarkdown?.call(this, node, helpers, context) ?? "";
    const level = Number(node.attrs?.indent ?? 0);
    return level > 0 && text ? NBSP.repeat(level * INDENT_UNIT) + text : text;
  },
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // A keyboard's Tab and Shift-Tab, outside lists (lists nest their own).
      Tab: () => (inList(this.editor) ? false : (shiftIndent(this.editor, 1), true)),
      "Shift-Tab": () => (inList(this.editor) ? false : (shiftIndent(this.editor, -1), true)),
      // Backspace at the start of an indented line or heading steps it back
      // out first.
      Backspace: () => {
        const { empty, $from } = this.editor.state.selection;
        if (!empty || $from.parentOffset !== 0 || inList(this.editor)) return false;
        if (!((($from.parent.attrs.indent as number) ?? 0) > 0)) return false;
        return shiftIndent(this.editor, -1);
      },
    };
  },
});

// TEMPORARY (2026-10-03): traces keys and changes near the cursor to the dev
// server's log, to find how a ticked item's strikethrough reaches the line
// under it on the iPhone. Remove once that is fixed.
const TRACE = true;
function brief(node: ProseMirrorNode): string {
  if (node.isTextblock) {
    const marks = new Set<string>();
    node.forEach((child) => child.marks.forEach((mark) => marks.add(mark.type.name)));
    return `"${node.textContent.slice(0, 12)}"${marks.size ? `{${[...marks].join(",")}}` : ""}`;
  }
  if (node.type.name === "taskItem" || node.type.name === "listItem") {
    const mark = node.type.name === "taskItem" ? (node.attrs.checked ? "[x]" : "[ ]") : "*";
    const parts: string[] = [];
    node.forEach((child) => parts.push(brief(child)));
    return mark + parts.join("+");
  }
  const parts: string[] = [];
  node.forEach((child, _offset, index) => {
    if (index < 3 || index >= node.childCount - 3) parts.push(brief(child));
    else if (index === 3) parts.push("…");
  });
  return `${node.type.name}{${parts.join(",")}}`;
}
function around(state: EditorView["state"]): string {
  const { $from, from, to } = state.selection;
  const path = Array.from({ length: $from.depth + 1 }, (_, depth) => $from.node(depth).type.name).join(">");
  const top = $from.index(0);
  const blocks: string[] = [];
  for (let index = Math.max(0, top - 1); index <= Math.min(state.doc.childCount - 1, top + 1); index++) {
    blocks.push((index === top ? ">>" : "") + brief(state.doc.child(index)));
  }
  return `sel=${from}-${to} off=${$from.parentOffset} path=${path} | ${blocks.join(" | ")}`;
}
// Typing or deleting within one line: not worth a line in the trace.
function plainTyping(tr: Transaction): boolean {
  if (tr.steps.length !== 1 || !(tr.steps[0] instanceof ReplaceStep)) return false;
  const step = tr.steps[0];
  const before = tr.docs[0];
  const $from = before.resolve(step.from);
  if (!$from.parent.isTextblock || !$from.sameParent(before.resolve(step.to))) return false;
  if (step.slice.openStart || step.slice.openEnd) return false;
  let inline = true;
  step.slice.content.forEach((node) => {
    if (!node.isInline) inline = false;
  });
  return inline;
}
let lastWasTyping = false;
function trace(view: EditorView | null, ...parts: unknown[]) {
  if (TRACE) console.log("[editor]", ...parts, view ? around(view.state) : "");
}

/**
 * Backspace at the start of a list item. On an empty item the line goes and
 * the cursor goes to the end of the line above, as in checklist apps. On an
 * item with words only its checkbox, number or bullet goes, as in Notes (a
 * nested one steps out a level instead); another Backspace then joins it to
 * the line above.
 */
function backspaceAtItemStart(editor: Editor): boolean {
  const { empty, $from } = editor.state.selection;
  if (!empty || $from.parentOffset !== 0 || $from.depth < 2) return false;
  const item = $from.node($from.depth - 1);
  if (item.type.name !== "listItem" && item.type.name !== "taskItem") return false;
  // A later line inside an item (an empty one Safari merged in, say) joins
  // the line before it in the same item. Tiptap's list keymap would take
  // the whole item's checkbox or number off instead.
  if ($from.index($from.depth - 1) !== 0) {
    const joined = editor.commands.joinBackward();
    return joined;
  }
  // An empty item (one empty line, nothing nested): delete it outright, and
  // the list with it if it was the only item.
  if (item.childCount === 1 && $from.parent.content.size === 0) {
    const itemDepth = $from.depth - 1;
    const listDepth = itemDepth - 1;
    const onlyItem = $from.node(listDepth).childCount === 1;
    const from = onlyItem ? $from.before(listDepth) : $from.before(itemDepth);
    const to = onlyItem ? $from.after(listDepth) : $from.after(itemDepth);
    // Only if there is a line above to go to, and it is not a ticked item:
    // there, what was typed next would go into the ticked line and be struck
    // through. Otherwise only the checkbox goes, and the empty line stays.
    const above = Selection.findFrom(editor.state.doc.resolve(from), -1, true);
    if (above && !inTickedItem(above.$from)) {
      const tr = editor.state.tr.delete(from, to);
      const end = Selection.findFrom(tr.doc.resolve(tr.mapping.map(from)), -1, true);
      if (end) tr.setSelection(end);
      editor.view.dispatch(tr.scrollIntoView());
      return true;
    }
  }
  const lifted = editor.chain().liftListItem(item.type.name).run();
  return lifted;
}

/** Whether a position is in a ticked checklist item's own words. */
function inTickedItem($pos: ResolvedPos): boolean {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === "taskItem") return Boolean(node.attrs.checked);
    if (node.type.name === "listItem") return false;
  }
  return false;
}

/**
 * An empty checklist row is never ticked. A new row made by Enter on a
 * ticked one must not come ticked (iOS makes the new line itself and can
 * copy the ticked state onto it), and an emptied row has nothing done.
 */
const UntickEmptyRows = Extension.create({
  name: "untickEmptyRows",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (transactions, _before, state) => {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const tr = state.tr;
          state.doc.descendants((node, pos) => {
            if (node.type.name === "taskItem" && node.attrs.checked && node.childCount === 1 && node.textContent === "") {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: false });
            }
            return !node.isTextblock;
          });
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});

/** Whether a block ends with a ticked checklist item (going down its last items). */
function endsTicked(block: ProseMirrorNode): boolean {
  let list: ProseMirrorNode | null = block;
  let ticked = false;
  while (list && LISTS.includes(list.type.name) && list.lastChild) {
    const item: ProseMirrorNode = list.lastChild;
    ticked = item.type.name === "taskItem" && Boolean(item.attrs.checked);
    list = item.lastChild && LISTS.includes(item.lastChild.type.name) ? item.lastChild : null;
  }
  return ticked;
}

/**
 * Backspace at the start of a line with words, right under a ticked item:
 * the words are not pulled into the ticked item, where they would look done
 * (struck through). The cursor goes to the end of the ticked line instead.
 */
function backspaceIntoTickedItem(editor: Editor): boolean {
  const { empty, $from } = editor.state.selection;
  if (!empty || $from.parentOffset !== 0 || $from.parent.type.name !== "paragraph") return false;
  // An empty line just goes, as before: nothing of it would be struck.
  if ($from.parent.content.size === 0 || $from.depth < 1) return false;
  const index = $from.index($from.depth - 1);
  if (index === 0 || !endsTicked($from.node($from.depth - 1).child(index - 1))) return false;
  const end = Selection.findFrom(editor.state.doc.resolve($from.before($from.depth)), -1, true);
  if (end) editor.view.dispatch(editor.state.tr.setSelection(end).scrollIntoView());
  return true;
}

/** Runs the key through the editor's keymaps, naming the one that took it. */
function runKeymaps(view: EditorView, event: KeyboardEvent): string | null {
  if (view.props.handleKeyDown?.call(view, view, event)) return "view";
  for (const plugin of view.state.plugins) {
    const handle = plugin.props.handleKeyDown;
    if (handle?.call(plugin, view, event)) return (plugin as unknown as { key?: string }).key ?? "plugin";
  }
  return null;
}

/**
 * Backspace at the start of a line, made the same everywhere: ahead of the
 * list keymaps, and never left to Safari. On the iPhone, backspacing through
 * a word reopens it for autocorrect (a "composition"), and ProseMirror skips
 * key presses during one and for half a second after (a Safari safeguard).
 * The Backspace that should take off an emptied item's checkbox then went to
 * Safari, which deleted the line itself and left the cursor at the start of
 * the line above, so the next Backspace took that line's checkbox too. Here
 * the key is caught before that safeguard, and the editor's own Backspace
 * runs. (iOS's deletion without a key press, `beforeinput`, is caught too.)
 */
const LineStartBackspace = Extension.create({
  name: "lineStartBackspace",
  priority: 1000,
  addKeyboardShortcuts() {
    return { Backspace: () => backspaceAtItemStart(this.editor) || backspaceIntoTickedItem(this.editor) };
  },
  addProseMirrorPlugins() {
    // Set while a Backspace this editor has just taken is still being
    // delivered: iOS can follow it with its own deletion for the same press.
    let pressTaken = false;
    return [
      new Plugin({
        // TEMPORARY tracing (see TRACE).
        view: () => ({
          update: (view, before) => {
            if (TRACE && !lastWasTyping && !before.doc.eq(view.state.doc)) trace(view, "doc changed:");
          },
        }),
        appendTransaction: (transactions) => {
          if (!TRACE) return null;
          lastWasTyping = transactions.every((tr) => !tr.docChanged || plainTyping(tr));
          for (const tr of transactions) {
            if (!tr.docChanged || plainTyping(tr)) continue;
            const meta = Object.keys((tr as unknown as { meta: Record<string, unknown> }).meta ?? {}).join(",");
            const steps = tr.steps.map((step) => {
              const json = step.toJSON() as { stepType: string; from?: number; to?: number; pos?: number };
              return `${json.stepType}@${json.from ?? json.pos}-${json.to ?? ""}`;
            });
            const stored = tr.storedMarks?.map((mark) => mark.type.name).join(",");
            console.log("[editor] transaction", `meta=[${meta}]`, `steps=[${steps.join(" ")}]`, stored ? `stored=${stored}` : "");
          }
          return null;
        },
        props: {
          handleDOMEvents: {
            compositionstart: (view) => {
              trace(view, "compositionstart");
              return false;
            },
            compositionend: (view) => {
              trace(view, "compositionend");
              return false;
            },
            input: (view, event) => {
              const input = event as InputEvent;
              if (TRACE && !(input.inputType === "insertText" && input.data !== null))
                trace(view, `input type=${input.inputType}`);
              return false;
            },
            keydown: (view, event) => {
              const key = event as KeyboardEvent;
              // A new press: whatever the last one did, it is over.
              pressTaken = false;
              if (TRACE && (key.key === "Backspace" || key.key === "Enter" || key.keyCode === 229))
                trace(view, `keydown key=${key.key} code=${key.keyCode} shift=${key.shiftKey} composing=${key.isComposing}/${view.composing}`);
              if (key.key !== "Backspace" || key.altKey || key.ctrlKey || key.metaKey) return false;
              // The iPhone reports Shift held whenever its keyboard is set to
              // capitalise, as at the start of every new line. It is still a
              // plain Backspace, and gets the same rules: the keymaps see it
              // unshifted (they only bind "Backspace").
              const plain = key.shiftKey ? new KeyboardEvent("keydown", { key: "Backspace", code: "Backspace" }) : key;
              // Changes typed a moment ago may still be waiting to be read.
              (view as unknown as { domObserver?: { forceFlush?: () => void } }).domObserver?.forceFlush?.();
              const { empty, $from } = view.state.selection;
              if (!empty || $from.parentOffset !== 0) return false;
              // In a list: this editor's rule, first and directly. Elsewhere at
              // a line's start: the editor's own Backspace. Never Safari's.
              let by: string | null =
                backspaceAtItemStart(this.editor) || backspaceIntoTickedItem(this.editor) ? "rule" : null;
              by ??= runKeymaps(view, plain);
              if (TRACE) trace(view, `keydown Backspace taken by ${by ?? "nobody (Safari's own)"}`);
              if (!by) return false;
              event.preventDefault();
              // One press, one action: iOS's own deletion for this same press
              // (it can still send one) is not acted on as well.
              pressTaken = true;
              setTimeout(() => {
                pressTaken = false;
              }, 0);
              return true;
            },
            beforeinput: (view, event) => {
              if (TRACE) {
                const input = event as InputEvent;
                if (!input.inputType.startsWith("insertText") || input.data === null)
                  trace(view, `beforeinput type=${input.inputType} composing=${input.isComposing}/${view.composing} cancelable=${input.cancelable} taken=${pressTaken}`);
              }
              if ((event as InputEvent).inputType !== "deleteContentBackward") return false;
              if (pressTaken) {
                event.preventDefault();
                return true;
              }
              const { empty, $from } = view.state.selection;
              if (!empty || $from.parentOffset !== 0) return false;
              const key = new KeyboardEvent("keydown", { key: "Backspace", code: "Backspace" });
              const handled = view.someProp("handleKeyDown", (handle) => handle(view, key));
              if (TRACE) trace(view, `beforeinput Backspace handled=${Boolean(handled)}`);
              if (!handled) return false;
              event.preventDefault();
              return true;
            },
          },
        },
      }),
    ];
  },
});

/**
 * Backspace at the start of a line in a quote, or right under one, as
 * Tiptap's quote does it: a later line in a quote steps out of it (the first
 * line does too, by the editor's own Backspace), and a line right under a
 * quote joins its last line.
 */
function backspaceAtQuote(editor: Editor): boolean {
  const { selection, schema } = editor.state;
  const { $from } = selection;
  if (!selection.empty || $from.parentOffset !== 0 || $from.depth < 1) return false;
  const quote = schema.nodes.blockquote;
  const parent = $from.node($from.depth - 1);
  const index = $from.index($from.depth - 1);
  if (index === 0) return false;
  if (parent.type === quote) return editor.commands.lift(quote.name);
  const previous = parent.child(index - 1);
  if (previous.type !== quote || !previous.lastChild?.isTextblock) return false;
  // The line's words go onto the end of the quote's last line.
  const lineStart = $from.before();
  const quoteLineEnd = lineStart - 2;
  const tr = editor.state.tr.delete(lineStart, $from.after()).insert(quoteLineEnd, $from.parent.content);
  tr.setSelection(TextSelection.create(tr.doc, quoteLineEnd));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Quotes, with their Backspace done here (backspaceAtQuote). Tiptap's quote
 * (3.27.1, the version this app is held at) was published with a private copy
 * of ProseMirror inside it, and its own Backspace left a cursor made by that
 * copy. The editor did not recognise it as a cursor in text: it cancelled
 * every Backspace after it, and on the iPhone Enter stuck too, until the
 * cursor moved.
 *
 * After upgrading Tiptap this can stay as it is. To see whether the fault is
 * gone, search @tiptap/extension-blockquote/dist/index.js for "prosemirror":
 * a fixed release imports ProseMirror rather than carrying its own.
 */
const Quote = Blockquote.extend({
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-b": () => this.editor.commands.toggleBlockquote(),
      Backspace: () => backspaceAtQuote(this.editor),
    };
  },
});

// A link ends at its last letter: words typed after it are not part of it.
// (With autolink on, Tiptap would otherwise let a link grow as you type.)
const NoteLink = Link.extend({ inclusive: () => false });

// The app's own typeface. Metro hands back an asset id (or its URL); the
// font then comes from the dev server, or from the app's own files.
function fontUrl(asset: unknown): string {
  try {
    if (typeof asset === "string") return asset;
    if (asset && typeof asset === "object" && "uri" in asset) return String((asset as { uri: string }).uri);
    return Asset.fromModule(asset as number).uri;
  } catch {
    return "";
  }
}

function stateOf(editor: Editor): NoteEditorState {
  return {
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    strike: editor.isActive("strike"),
    heading: editor.isActive("heading"),
    quote: editor.isActive("blockquote"),
    bullet: editor.isActive("bulletList"),
    ordered: editor.isActive("orderedList"),
    task: editor.isActive("taskList"),
    link: editor.isActive("link") ? ((editor.getAttributes("link").href as string | undefined) ?? "") : null,
    selection: !editor.state.selection.empty,
  };
}

function cursorOf(editor: Editor): NoteCursor {
  const { doc, selection } = editor.state;
  const at = selection.from;
  return {
    before: doc.textBetween(Math.max(0, at - BEFORE_CHARS), at, "\n", " "),
    after: doc.textBetween(at, Math.min(doc.content.size, at + AFTER_CHARS), "\n", " "),
  };
}

/**
 * A note's text, rich: headings, bold, italic and struck words, bullet,
 * numbered and check lists that indent, quotes and links. Tiptap
 * (ProseMirror) in a web view, reading and writing Markdown, so the note is
 * still one string everywhere else (search, the AI, the outbox). The app
 * drives it with `run` and hears back its Markdown, the cursor and the
 * formats there.
 */
export default function NoteEditor({
  ref,
  markdown,
  doc,
  seed,
  placeholder,
  autoFocus,
  palette,
  fontSize,
  lineHeight,
  onChange,
  onCursor,
  onState,
  onFocusChange,
  onReady,
  dom: _dom,
}: Props) {
  const lastState = useRef("");
  // Props from the app after the first: each set crossed over whole, so the
  // timing log counts them.
  const renders = useRef(0);
  renders.current += 1;
  if (renders.current > 1) perfCount("props received");
  // The note is on screen (its text in, focused if new): said once.
  const announced = useRef(false);
  const announce = (current: Editor) => {
    if (announced.current) return;
    announced.current = true;
    if (autoFocus) current.commands.focus("end");
    void onReady();
  };
  const lastCursor = useRef("");
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reportCursor = (editor: Editor) => {
    if (cursorTimer.current) clearTimeout(cursorTimer.current);
    cursorTimer.current = setTimeout(() => {
      const cursor = cursorOf(editor);
      const key = JSON.stringify(cursor);
      if (key === lastCursor.current) return;
      lastCursor.current = key;
      void onCursor(cursor);
    }, CURSOR_MS);
  };

  // A change not yet sent to the app, and since when.
  const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changeSince = useRef(0);
  const sendChange = (current: Editor) => {
    if (changeTimer.current) clearTimeout(changeTimer.current);
    changeTimer.current = null;
    const started = perfNow();
    // Lists leave empty lines at the end; they are not the writer's.
    const markdown = current.getMarkdown().replace(/\n+$/, "");
    const json = current.getJSON();
    perfRecord("change packed", perfNow() - started, kbOf(markdown));
    void onChange(markdown, json, perfClock());
  };
  const scheduleChange = (current: Editor) => {
    const now = Date.now();
    if (changeTimer.current) clearTimeout(changeTimer.current);
    else changeSince.current = now;
    const wait = Math.max(0, Math.min(CHANGE_PAUSE_MS, changeSince.current + CHANGE_MAX_WAIT_MS - now));
    changeTimer.current = setTimeout(() => sendChange(current), wait);
  };
  const flushChange = (current: Editor | null) => {
    if (current && changeTimer.current) sendChange(current);
  };

  // Made once: given anew on every render, Tiptap would take them as new
  // settings each time and redo its setup.
  const extensions = useMemo(
    () => [
      StarterKit.configure({ paragraph: false, blockquote: false, heading: { levels: [1, 2, 3] }, hardBreak: false, link: false }),
      Quote,
      IndentedParagraph,
      Indent,
      LineStartBackspace,
      UntickEmptyRows,
      LineBreak,
      NoteLink.configure({ openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: "https" }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
      Markdown.configure({ markedOptions: { breaks: true, gfm: true } }),
    ],
    // The placeholder is the only setting here, and it never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const editorProps = useMemo(
    () => ({ attributes: { autocapitalize: "sentences", autocorrect: "on", spellcheck: "true" } }),
    [],
  );

  const editor = useEditor({
    extensions,
    content: markdown,
    contentType: "markdown",
    editorProps,
    // Text that came with the first props is on screen already.
    onCreate: ({ editor: current }) => {
      if (seed !== "boot") announce(current);
    },
    // Changes go over in batches (see CHANGE_PAUSE_MS). Leaving the note
    // must never lose the last words typed: the keyboard closing, the page
    // being hidden and the app asking all send what is waiting at once.
    onUpdate: ({ editor: current }) => {
      scheduleChange(current);
      reportCursor(current);
    },
    onSelectionUpdate: ({ editor: current }) => reportCursor(current),
    onTransaction: ({ editor: current }) => {
      const state = stateOf(current);
      const key = JSON.stringify(state);
      if (key === lastState.current) return;
      lastState.current = key;
      void onState(state, perfClock());
    },
    onFocus: ({ editor: current }) => {
      void onFocusChange(true);
      reportCursor(current);
    },
    onBlur: ({ editor: current }) => {
      flushChange(current);
      void onFocusChange(false);
    },
  });

  // The page hidden (the app going to the background, or closing): what is
  // waiting goes now, while it still can.
  const editorRef = useRef(editor);
  editorRef.current = editor;
  useEffect(() => {
    const flush = () => flushChange(editorRef.current);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      flush();
    };
    // flushChange only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The note's text, once the app sends it, and any new copy of it from
  // outside later (the server's, a restored draft).
  const firstSeed = useRef(seed);
  useEffect(() => {
    if (!editor || seed === firstSeed.current) return;
    firstSeed.current = seed;
    if (seed === "boot") return;
    // Words typed here and not yet sent are newer than any copy the app
    // has: they stay, and go over now. (Before batching, the app knew of
    // them already, and would not have sent a copy over them.)
    if (changeTimer.current) {
      sendChange(editor);
      return;
    }
    // The rich text when the note has it; its Markdown otherwise (notes from
    // before rich text, or edited as plain text since).
    const rich = doc && typeof doc === "object" && (doc as { type?: unknown }).type === "doc";
    if (rich) editor.commands.setContent(doc as JSONContent, { emitUpdate: false });
    else editor.commands.setContent(markdown, { contentType: "markdown", emitUpdate: false });
    announce(editor);
    // Only the seed says when to take the text in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, seed]);

  useDOMImperativeHandle(
    ref as React.Ref<NoteEditorHandle>,
    () => ({
      run: (...args: unknown[]) => {
        if (!editor) return;
        const [name, rawValue, tappedAt] = args as [string, string | null | undefined, number | undefined];
        const value = rawValue ?? undefined;
        // A toolbar tap: how long it took to get here from the app, and to
        // be on screen.
        if (typeof tappedAt === "number") {
          const arrived = perfClock() - tappedAt;
          perfRecord("toolbar tap → editor", arrived);
          const composing = editor.view.composing;
          requestAnimationFrame(() => {
            const drawn = perfClock() - tappedAt;
            perfRecord("toolbar tap → on screen", drawn);
            perfMark(`${name}: reached the editor ${arrived} ms after the tap, on screen at ${drawn} ms${composing ? " (mid-word)" : ""}`);
          });
        }
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
          // In a list, an item nests under the one before it (or comes back
          // out); anywhere else the line itself moves in or out.
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
            if (!text) break;
            const at = editor.state.selection.from;
            const before = editor.state.doc.textBetween(Math.max(0, at - 40), at, "\n", " ");
            const spaces = trimBefore ? before.length - before.trimEnd().length : 0;
            let run = chain();
            if (spaces > 0) run = run.deleteRange({ from: at - spaces, to: at });
            run.insertContent({ type: "text", text }).run();
            break;
          }
          // A question: its own line where the cursor is, then an empty line
          // under it, ready for the answer.
          case "insertQuestion":
            if (value)
              chain()
                .insertContent([{ type: "paragraph", content: [{ type: "text", text: value }] }, { type: "paragraph" }])
                .run();
            break;
          // With the suggestion tray in the keyboard's place, a tap moves
          // the cursor and brings no keyboard.
          case "tray":
            editor.view.dom.setAttribute("inputmode", value === "on" ? "none" : "text");
            if (value === "on") editor.commands.blur();
            break;
          // Back to typing here. Text focused while the tray was open has no
          // keyboard; it has to let go and take focus again for one to come.
          case "keyboard":
            editor.view.dom.setAttribute("inputmode", "text");
            editor.commands.blur();
            setTimeout(() => editor.commands.focus(), 50);
            break;
          case "focus":
            editor.commands.focus();
            break;
          case "blur":
            editor.commands.blur();
            break;
        }
      },
    }),
    [editor],
  );

  const css = useMemo(() => {
    const regular = fontUrl(require("@expo-google-fonts/nunito-sans/400Regular/NunitoSans_400Regular.ttf"));
    const italic = fontUrl(require("@expo-google-fonts/nunito-sans/400Regular_Italic/NunitoSans_400Regular_Italic.ttf"));
    const bold = fontUrl(require("@expo-google-fonts/nunito-sans/700Bold/NunitoSans_700Bold.ttf"));
    const face = (url: string, weight: number, style: string) =>
      url ? `@font-face { font-family: "Clarity"; src: url("${url}"); font-weight: ${weight}; font-style: ${style}; }` : "";
    return `
      ${face(regular, 400, "normal")}
      ${face(italic, 400, "italic")}
      ${face(bold, 700, "normal")}
      html, body { margin: 0; padding: 0; background: transparent; -webkit-text-size-adjust: 100%; }
      body { -webkit-tap-highlight-color: transparent; }
      .ProseMirror {
        outline: none; box-sizing: border-box; min-height: 100vh;
        padding: 12px 16px ${lineHeight * 2}px;
        font-family: "Clarity", -apple-system, system-ui, sans-serif;
        font-size: ${fontSize}px; line-height: ${lineHeight}px;
        color: ${palette.text}; caret-color: ${palette.accent};
        word-wrap: break-word; white-space: pre-wrap;
        -webkit-user-select: text; user-select: text;
      }
      .ProseMirror p { margin: 0; }
      ${Array.from({ length: MAX_INDENT }, (_, i) => `.ProseMirror [data-indent="${i + 1}"] { margin-left: ${1.6 * (i + 1)}em; }`).join("\n      ")}
      .ProseMirror h1, .ProseMirror h2, .ProseMirror h3 { font-weight: 700; line-height: 1.3; margin: 14px 0 4px; }
      .ProseMirror h1 { font-size: 1.45em; }
      .ProseMirror h2 { font-size: 1.25em; }
      .ProseMirror h3 { font-size: 1.1em; }
      .ProseMirror strong { font-weight: 700; }
      .ProseMirror ul, .ProseMirror ol { margin: 0; padding-left: 1.45em; }
      .ProseMirror li > p { margin: 0; }
      .ProseMirror ul[data-type="taskList"] { list-style: none; padding-left: 0.1em; }
      .ProseMirror ul[data-type="taskList"] li { display: flex; gap: 10px; align-items: flex-start; }
      /* The checkbox sits in a box exactly one line tall, so a checklist row is
         as tall as any other line and nothing moves when it changes. */
      .ProseMirror ul[data-type="taskList"] li > label {
        flex: 0 0 auto; display: flex; align-items: center; height: ${lineHeight}px; margin: 0;
      }
      .ProseMirror ul[data-type="taskList"] li > div { flex: 1; min-width: 0; }
      .ProseMirror ul[data-type="taskList"] li[data-checked="true"] > div { color: ${palette.muted}; text-decoration: line-through; }
      .ProseMirror ul[data-type="taskList"] input { width: 20px; height: 20px; margin: 0; accent-color: ${palette.accent}; }
      .ProseMirror blockquote { margin: 4px 0; padding-left: 12px; border-left: 3px solid ${palette.border}; color: ${palette.muted}; }
      .ProseMirror a { color: ${palette.accent}; text-decoration: underline; text-underline-offset: 2px; }
      .ProseMirror code { background: ${palette.surface}; border-radius: 4px; padding: 1px 4px; font-size: 0.9em; }
      .ProseMirror p.is-editor-empty:first-child::before {
        content: attr(data-placeholder); color: ${palette.muted}; float: left; height: 0; pointer-events: none;
      }
    `;
  }, [palette, fontSize, lineHeight]);

  return (
    <>
      <style>{css}</style>
      <EditorContent editor={editor} />
    </>
  );
}
