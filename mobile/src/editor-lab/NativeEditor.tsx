import React, { forwardRef, useImperativeHandle, useRef } from "react";
import {
  EnrichedTextInput,
  type EnrichedTextInputInstance,
  type OnChangeStateEvent,
} from "react-native-enriched-html";
import type { LabEditorState } from "./TiptapEditor";

/** What the lab asks of the editor; false when this editor cannot do it. */
export type NativeLabHandle = {
  run: (name: string, value?: string, size?: { width: number; height: number }) => boolean;
};

type Props = {
  /** The note to start from, as HTML. */
  html: string;
  palette: { text: string; muted: string; accent: string; border: string; surface: string };
  fontSize: number;
  onHtml: (html: string) => void;
  onState: (state: LabEditorState) => void;
};

// Typing these at the start of a line starts the block, as Tiptap's do.
const SHORTCUTS = [
  { trigger: "- ", style: "unordered_list" as const },
  { trigger: "1. ", style: "ordered_list" as const },
  { trigger: "[] ", style: "checkbox_list" as const },
  { trigger: "## ", style: "h2" as const },
  { trigger: "> ", style: "blockquote" as const },
];

/**
 * The native candidate for the editor lab: react-native-enriched-html, a
 * real iOS text view writing HTML. It has no indent (so no nested lists) and
 * no undo commands; `run` says so by returning false.
 */
export const NativeEditor = forwardRef<NativeLabHandle, Props>(function NativeEditor(
  { html, palette, fontSize, onHtml, onState },
  ref,
) {
  const input = useRef<EnrichedTextInputInstance>(null);
  const selection = useRef({ start: 0, end: 0, text: "" });

  useImperativeHandle(ref, () => ({
    run: (name, value, size) => {
      const editor = input.current;
      if (!editor) return false;
      switch (name) {
        case "bold":
          editor.toggleBold();
          return true;
        case "italic":
          editor.toggleItalic();
          return true;
        case "strike":
          editor.toggleStrikeThrough();
          return true;
        case "heading":
          editor.toggleH2();
          return true;
        case "bullet":
          editor.toggleUnorderedList();
          return true;
        case "ordered":
          editor.toggleOrderedList();
          return true;
        case "task":
          editor.toggleCheckboxList(false);
          return true;
        case "link": {
          const { start, end, text } = selection.current;
          if (!value) editor.removeLink(start, end);
          else editor.setLink(start, end, start === end ? value : text, value);
          return true;
        }
        case "image":
          if (!value || !size) return false;
          editor.setImage(value, size.width, size.height);
          return true;
        case "blur":
          editor.blur();
          return true;
        default:
          // indent, outdent, undo, redo
          return false;
      }
    },
  }));

  return (
    <EnrichedTextInput
      ref={input}
      defaultValue={html}
      placeholder="Start writing…"
      placeholderTextColor={palette.muted}
      cursorColor={palette.accent}
      selectionColor={palette.accent}
      textShortcuts={SHORTCUTS}
      scrollEnabled
      style={{
        flex: 1,
        fontSize,
        color: palette.text,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 160,
      }}
      htmlStyle={{
        a: { color: palette.accent },
        blockquote: { borderColor: palette.border, color: palette.muted },
      }}
      onChangeHtml={(event) => onHtml(event.nativeEvent.value)}
      onChangeSelection={(event) => {
        selection.current = event.nativeEvent;
      }}
      onChangeState={(event: { nativeEvent: OnChangeStateEvent }) => {
        const state = event.nativeEvent;
        onState({
          bold: state.bold.isActive,
          italic: state.italic.isActive,
          strike: state.strikeThrough.isActive,
          heading: state.h2.isActive,
          bullet: state.unorderedList.isActive,
          ordered: state.orderedList.isActive,
          task: state.checkboxList.isActive,
          link: state.link.isActive,
        });
      }}
    />
  );
});
