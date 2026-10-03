"use dom";

import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useDOMImperativeHandle, type DOMImperativeFactory, type DOMProps } from "expo/dom";
import React, { useEffect, useRef } from "react";

/** Which formats apply where the cursor is, for the toolbar. */
export type LabEditorState = {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  heading: boolean;
  bullet: boolean;
  ordered: boolean;
  task: boolean;
  link: boolean;
};

/** What the app can ask of the editor: `run("bold")`, `run("link", url)`… */
export interface TiptapLabHandle extends DOMImperativeFactory {
  run: (...args: unknown[]) => void;
}

type Props = {
  ref?: React.Ref<TiptapLabHandle>;
  /** The note to start from, as Markdown. */
  markdown: string;
  palette: { text: string; muted: string; accent: string; border: string; surface: string };
  fontSize: number;
  onMarkdown: (markdown: string) => Promise<void>;
  onState: (state: LabEditorState) => Promise<void>;
  dom?: DOMProps;
};

// The Markdown is sent to the app once the typing pauses, not on every key.
const REPORT_MS = 250;

function stateOf(editor: Editor): LabEditorState {
  return {
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    strike: editor.isActive("strike"),
    heading: editor.isActive("heading"),
    bullet: editor.isActive("bulletList"),
    ordered: editor.isActive("orderedList"),
    task: editor.isActive("taskList"),
    link: editor.isActive("link"),
  };
}

/**
 * The Tiptap candidate for the editor lab: Tiptap (ProseMirror) in a web
 * view, reading and writing Markdown. The app drives it through `run` and
 * hears back its Markdown and the formats at the cursor.
 */
export default function TiptapEditor({ ref, markdown, palette, fontSize, onMarkdown, onState, dom: _dom }: Props) {
  const reportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastState = useRef("");

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, linkOnPaste: true },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({ allowBase64: true }),
      Placeholder.configure({ placeholder: "Start writing…" }),
      Markdown,
    ],
    content: markdown,
    contentType: "markdown",
    onUpdate: ({ editor: current }) => {
      if (reportTimer.current) clearTimeout(reportTimer.current);
      reportTimer.current = setTimeout(() => void onMarkdown(current.getMarkdown()), REPORT_MS);
    },
    onTransaction: ({ editor: current }) => {
      const state = stateOf(current);
      const key = JSON.stringify(state);
      if (key === lastState.current) return;
      lastState.current = key;
      void onState(state);
    },
  });

  // The starting Markdown, so the output shows before any typing.
  useEffect(() => {
    if (editor) void onMarkdown(editor.getMarkdown());
    // Once, when the editor is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useDOMImperativeHandle(
    ref as React.Ref<TiptapLabHandle>,
    () => ({
      run: (...args: unknown[]) => {
        if (!editor) return;
        const [name, value] = args as [string, string | undefined];
        const chain = editor.chain().focus();
        switch (name) {
          case "bold":
            chain.toggleBold().run();
            break;
          case "italic":
            chain.toggleItalic().run();
            break;
          case "strike":
            chain.toggleStrike().run();
            break;
          case "heading":
            chain.toggleHeading({ level: 2 }).run();
            break;
          case "bullet":
            chain.toggleBulletList().run();
            break;
          case "ordered":
            chain.toggleOrderedList().run();
            break;
          case "task":
            chain.toggleTaskList().run();
            break;
          case "indent":
            if (!editor.chain().focus().sinkListItem("listItem").run()) editor.chain().focus().sinkListItem("taskItem").run();
            break;
          case "outdent":
            if (!editor.chain().focus().liftListItem("listItem").run()) editor.chain().focus().liftListItem("taskItem").run();
            break;
          case "link":
            if (!value) {
              chain.unsetLink().run();
            } else if (editor.state.selection.empty) {
              chain.insertContent({ type: "text", text: value, marks: [{ type: "link", attrs: { href: value } }] }).run();
            } else {
              chain.extendMarkRange("link").setLink({ href: value }).run();
            }
            break;
          case "image":
            if (value) chain.setImage({ src: value }).run();
            break;
          case "undo":
            chain.undo().run();
            break;
          case "redo":
            chain.redo().run();
            break;
          case "blur":
            editor.commands.blur();
            break;
        }
      },
    }),
    [editor],
  );

  const css = `
    html, body { margin: 0; padding: 0; background: transparent; -webkit-text-size-adjust: 100%; }
    .ProseMirror {
      outline: none; min-height: 100vh; box-sizing: border-box;
      padding: 12px 16px 160px;
      font: ${fontSize}px/1.6 -apple-system, system-ui, sans-serif;
      color: ${palette.text}; caret-color: ${palette.accent};
      -webkit-user-select: text; user-select: text;
    }
    .ProseMirror p { margin: 0 0 10px; }
    .ProseMirror h1, .ProseMirror h2, .ProseMirror h3 { margin: 18px 0 8px; line-height: 1.3; }
    .ProseMirror h2 { font-size: 1.3em; }
    .ProseMirror ul, .ProseMirror ol { margin: 0 0 10px; padding-left: 1.5em; }
    .ProseMirror li > p { margin: 0 0 4px; }
    .ProseMirror ul[data-type="taskList"] { list-style: none; padding-left: 0.2em; }
    .ProseMirror ul[data-type="taskList"] li { display: flex; gap: 10px; align-items: flex-start; }
    .ProseMirror ul[data-type="taskList"] li > label { margin-top: 0.3em; }
    .ProseMirror ul[data-type="taskList"] li > div { flex: 1; }
    .ProseMirror ul[data-type="taskList"] input { width: 18px; height: 18px; accent-color: ${palette.accent}; }
    .ProseMirror blockquote { margin: 0 0 10px; padding-left: 12px; border-left: 3px solid ${palette.border}; color: ${palette.muted}; }
    .ProseMirror a { color: ${palette.accent}; }
    .ProseMirror img { max-width: 100%; height: auto; border-radius: 12px; display: block; margin: 6px 0 10px; }
    .ProseMirror img.ProseMirror-selectednode { outline: 3px solid ${palette.accent}; }
    .ProseMirror code { background: ${palette.surface}; border-radius: 4px; padding: 1px 4px; }
    .ProseMirror p.is-editor-empty:first-child::before {
      content: attr(data-placeholder); color: ${palette.muted}; float: left; height: 0; pointer-events: none;
    }
  `;

  return (
    <>
      <style>{css}</style>
      <EditorContent editor={editor} />
    </>
  );
}
