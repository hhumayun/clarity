/**
 * The main app's editor rules, carried over unchanged (mobile/src/editor/
 * NoteEditor.tsx at 4344bd8): indents that survive Markdown, Backspace at a
 * line's start made the same everywhere, empty checklist rows never ticked,
 * quotes with their own Backspace, and links that end at their last letter.
 * Only the temporary tracing (TRACE) is left out. Photos (2026-10-09) were
 * added here and in the main app together. Keep these in step with the
 * main app; `src/core/SOURCE.md` lists the differences.
 */
import Blockquote from "@tiptap/extension-blockquote";
import HardBreak from "@tiptap/extension-hard-break";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Paragraph from "@tiptap/extension-paragraph";
import { Extension, type Editor, type JSONContent } from "@tiptap/core";
import { NodeSelection, Plugin, Selection, TextSelection } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode, ResolvedPos } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

// A line break is kept as a plain new line, and read back as one (marked's
// `breaks`), so the note's text stays readable anywhere it is shown as
// plain text, and notes written before rich text keep their lines.
export const LineBreak = HardBreak.extend({ renderMarkdown: () => "\n" });

// An indent, up to six steps, on a paragraph, a heading or a whole list. The
// rich text keeps it as a level. Its Markdown keeps a paragraph's as four
// non-breaking spaces a step at the start of the line: they survive the
// Markdown reader (it trims only ordinary spaces) and read as the indent they
// are wherever the note is shown as plain text. A heading's or a list's lives
// in the rich text only.
const NBSP = " ";
const INDENT_UNIT = 4;
export const MAX_INDENT = 6;
type InlineToken = { type: string; raw?: string; text?: string };

/** The indent at the start of a paragraph's words in Markdown, taken off them. */
function takeIndent(tokens: InlineToken[]): { level: number; tokens: InlineToken[] } {
  const first = tokens[0];
  if (!first || first.type !== "text" || typeof first.text !== "string") return { level: 0, tokens };
  const run = first.text.length - first.text.replace(/^ +/, "").length;
  const level = Math.min(MAX_INDENT, Math.floor(run / INDENT_UNIT));
  if (level === 0) return { level, tokens };
  const strip = (value?: string) => (value ?? "").slice(level * INDENT_UNIT);
  const rest = { ...first, text: strip(first.text), raw: strip(first.raw) };
  return { level, tokens: rest.text ? [rest, ...tokens.slice(1)] : tokens.slice(1) };
}

const LISTS = ["bulletList", "orderedList", "taskList"];
const clampIndent = (value: number) => Math.max(0, Math.min(MAX_INDENT, value));

/** The indent level, on the blocks that can have one. */
export const Indent = Extension.create({
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
export function shiftIndent(editor: Editor, delta: number): boolean {
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

export const inList = (editor: Editor) => editor.isActive("listItem") || editor.isActive("taskItem");

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
export function shiftInList(editor: Editor, delta: number) {
  const item = editor.isActive("taskItem") ? "taskItem" : "listItem";
  if (delta > 0) {
    if (!editor.chain().focus().sinkListItem(item).run()) shiftList(editor, 1);
    return;
  }
  const list = listAtCursor(editor);
  if (list && !list.nested && ((list.node.attrs.indent as number) ?? 0) > 0) shiftList(editor, -1);
  else editor.chain().focus().liftListItem(item).run();
}

export const IndentedParagraph = Paragraph.extend({
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
    return editor.commands.joinBackward();
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
  return editor.chain().liftListItem(item.type.name).run();
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
export const UntickEmptyRows = Extension.create({
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

/**
 * Backspace at the start of a line with words, right under a photo: the
 * photo is chosen (outlined), not taken away. The editor's own Backspace
 * deletes a photo there in one press, unseen; here it takes a second press.
 * (An empty line under a photo just goes, and the photo is chosen, as the
 * editor's own Backspace does it.)
 */
function backspaceUnderPhoto(editor: Editor): boolean {
  const { empty, $from } = editor.state.selection;
  if (!empty || $from.parentOffset !== 0 || $from.depth < 1 || $from.parent.content.size === 0) return false;
  const index = $from.index($from.depth - 1);
  if (index === 0) return false;
  const before = $from.node($from.depth - 1).child(index - 1);
  if (before.type.name !== "image") return false;
  const photoAt = $from.before($from.depth) - before.nodeSize;
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, photoAt)).scrollIntoView());
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
export const LineStartBackspace = Extension.create({
  name: "lineStartBackspace",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Backspace: () => backspaceUnderPhoto(this.editor) || backspaceAtItemStart(this.editor) || backspaceIntoTickedItem(this.editor),
    };
  },
  addProseMirrorPlugins() {
    // Set while a Backspace this editor has just taken is still being
    // delivered: iOS can follow it with its own deletion for the same press.
    let pressTaken = false;
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            keydown: (view, event) => {
              const key = event as KeyboardEvent;
              // A new press: whatever the last one did, it is over.
              pressTaken = false;
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
                backspaceUnderPhoto(this.editor) || backspaceAtItemStart(this.editor) || backspaceIntoTickedItem(this.editor)
                  ? "rule"
                  : null;
              by ??= runKeymaps(view, plain);
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
              if ((event as InputEvent).inputType !== "deleteContentBackward") return false;
              if (pressTaken) {
                event.preventDefault();
                return true;
              }
              const { empty, $from } = view.state.selection;
              if (!empty || $from.parentOffset !== 0) return false;
              const key = new KeyboardEvent("keydown", { key: "Backspace", code: "Backspace" });
              const handled = view.someProp("handleKeyDown", (handle) => handle(view, key));
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
 */
export const Quote = Blockquote.extend({
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-b": () => this.editor.commands.toggleBlockquote(),
      Backspace: () => backspaceAtQuote(this.editor),
    };
  },
});

// A link ends at its last letter: words typed after it are not part of it.
// (With autolink on, Tiptap would otherwise let a link grow as you type.)
export const NoteLink = Link.extend({ inclusive: () => false });

/**
 * A photo's address in a note: `attachment:` and the photo's id. The photo
 * itself is a file kept apart from the note; the note only names it, as
 * `![](attachment:<id>)` in its Markdown and an `image` in its rich text.
 */
export const PHOTO_PREFIX = "attachment:";

/** The id of the photo an image's address names, or null for any other address. */
export function photoIdOf(src: unknown): string | null {
  return typeof src === "string" && src.startsWith(PHOTO_PREFIX) ? src.slice(PHOTO_PREFIX.length) || null : null;
}

/**
 * Each photo on a line of its own, in a note read from Markdown. A photo with
 * words on the very next line (`![](…)` then a line break, as a plain-text
 * editor can leave it), or one in a list item (its Markdown puts the photo
 * right under the item's words), reads back inside a line of words, where a
 * photo can't be: the line is split around it, and the line breaks beside it
 * go. A list item still starts with a line of words, if an empty one.
 */
export function liftPhotos(node: JSONContent): JSONContent {
  if (!node.content) return node;
  const content: JSONContent[] = [];
  for (const child of node.content.map(liftPhotos)) {
    const words = child.type === "paragraph" || child.type === "heading" ? child.content : undefined;
    if (!words?.some((inline) => inline.type === "image")) {
      content.push(child);
      continue;
    }
    let run: JSONContent[] = [];
    const endRun = () => {
      while (run[0]?.type === "hardBreak") run.shift();
      while (run[run.length - 1]?.type === "hardBreak") run.pop();
      if (run.length) content.push({ ...child, content: run });
      run = [];
    };
    for (const inline of words) {
      if (inline.type !== "image") {
        run.push(inline);
        continue;
      }
      endRun();
      const { marks: _marks, ...photo } = inline;
      content.push(photo);
    }
    endRun();
  }
  if ((node.type === "listItem" || node.type === "taskItem") && content[0]?.type !== "paragraph") content.unshift({ type: "paragraph" });
  return { ...node, content };
}

/**
 * Typing with a photo chosen: the words go on the line under it, and the
 * photo stays. (The editor would otherwise type over it, and the photo would
 * be gone.)
 */
function writeUnderChosenPhoto(view: EditorView, text: string): boolean {
  const { selection, schema } = view.state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== "image") return false;
  const after = selection.to;
  const tr = view.state.tr;
  if (!tr.doc.resolve(after).nodeAfter?.isTextblock) tr.insert(after, schema.nodes.paragraph.create());
  tr.setSelection(TextSelection.create(tr.doc, after + 1)).insertText(text);
  view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Photos: Tiptap's image, as a block of its own. A paste brings in only
 * photos kept apart from a note, never a web page's images or one written
 * into the note itself; one can't be dragged about by mistake, and typing
 * `![…](…)` doesn't make one. A photo goes only by Backspace or Delete while
 * it's chosen (backspaceUnderPhoto, writeUnderChosenPhoto). Images with
 * any other address (a web image typed into a note elsewhere) are kept as
 * written, and never loaded.
 */
export const Photo = Image.extend({
  draggable: false,
  parseHTML() {
    return [{ tag: `img[src^="${PHOTO_PREFIX}"]` }];
  },
  addInputRules() {
    return [];
  },
  addProseMirrorPlugins() {
    return [new Plugin({ props: { handleTextInput: (view, _from, _to, text) => writeUnderChosenPhoto(view, text) } })];
  },
});
