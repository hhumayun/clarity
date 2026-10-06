import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { EditorCommand, EditorCursor, EditorFormats, EditorLook, FromPage, ToPage } from "./protocol";

/** What the editor takes in: the note, again whenever `key` changes. */
export type EditorSeed = { key: string; markdown: string; doc: unknown; focus: "end" | null };

/** What the note page asks of the editor: `run("bold")`, `run("link", url)`… */
export type NoteEditorHandle = { run: (name: EditorCommand, value?: string) => void };

export type NoteEditorProps = {
  ref?: Ref<NoteEditorHandle>;
  look: EditorLook;
  seed: EditorSeed;
  /** The note as it now stands: its Markdown and its rich text, together. */
  onChange: (markdown: string, doc: unknown) => void;
  onFormats?: (formats: EditorFormats) => void;
  onCursor?: (cursor: EditorCursor) => void;
  onFocusChange?: (focused: boolean) => void;
  /** The note is on screen. */
  onShown?: () => void;
  /** The page didn't start, or broke before showing the note. */
  onFailed?: (reason: string) => void;
};

// A page that hasn't shown the note by now isn't going to.
const START_LIMIT_MS = 8_000;

/**
 * The note page's side of the channel to the editor page, shared by the
 * phone's web view and the web build's iframe. Nothing reaches the page
 * before it says it's ready: then the look and the note go in, then any
 * command that was waiting. If the page has to start again (iOS can end a
 * web view's process), it gets the words it last sent back.
 */
export function useEditorBridge(props: NoteEditorProps, deliver: (message: ToPage) => void) {
  const latest = useRef(props);
  latest.current = props;
  const deliverRef = useRef(deliver);
  deliverRef.current = deliver;

  const ready = useRef(false);
  const shown = useRef(false);
  const failed = useRef(false);
  const waiting = useRef<ToPage[]>([]);
  const sentSeed = useRef<string | null>(null);
  const sentLook = useRef("");
  // The words as the page last sent them, and how often it has started again.
  const content = useRef<{ markdown: string; doc: unknown } | null>(null);
  const restarts = useRef(0);

  const fail = (reason: string) => {
    if (failed.current || shown.current) return;
    failed.current = true;
    if (__DEV__) console.warn("[editor] didn't start:", reason);
    latest.current.onFailed?.(reason);
  };

  const run = (name: EditorCommand, value?: string) => {
    const message: ToPage = { type: "run", name, ...(value === undefined ? {} : { value }) };
    if (ready.current) deliverRef.current(message);
    else waiting.current.push(message);
  };
  useImperativeHandle(props.ref, () => ({ run }), []);

  const receive = (text: string) => {
    let message: FromPage;
    try {
      message = JSON.parse(text) as FromPage;
    } catch {
      return;
    }
    const current = latest.current;
    switch (message.type) {
      case "ready": {
        ready.current = true;
        const look = JSON.stringify(current.look);
        sentLook.current = look;
        deliverRef.current({ type: "look", look: current.look });
        const again = restarts.current > 0 ? content.current : null;
        if (again) {
          deliverRef.current({ type: "seed", seed: `${current.seed.key}~${restarts.current}`, markdown: again.markdown, doc: again.doc, focus: null });
        } else {
          deliverRef.current({ type: "seed", seed: current.seed.key, markdown: current.seed.markdown, doc: current.seed.doc, focus: current.seed.focus });
        }
        sentSeed.current = current.seed.key;
        for (const waited of waiting.current.splice(0)) deliverRef.current(waited);
        break;
      }
      case "shown":
        if (!shown.current) {
          shown.current = true;
          current.onShown?.();
        }
        break;
      case "change":
        content.current = { markdown: message.markdown, doc: message.doc };
        current.onChange(message.markdown, message.doc);
        break;
      case "formats":
        current.onFormats?.(message.formats);
        break;
      case "cursor":
        current.onCursor?.(message.cursor);
        break;
      case "focus":
        current.onFocusChange?.(message.focused);
        break;
      case "error":
        if (!shown.current) fail(message.message);
        else if (__DEV__) console.warn("[editor]", message.message);
        break;
    }
  };

  /** The page is starting again (its process ended): it says when it's ready. */
  const restart = () => {
    ready.current = false;
    restarts.current += 1;
  };

  // A new copy of the note (the server's, a restored draft, a new question).
  useEffect(() => {
    if (!ready.current || sentSeed.current === props.seed.key) return;
    sentSeed.current = props.seed.key;
    deliverRef.current({ type: "seed", seed: props.seed.key, markdown: props.seed.markdown, doc: props.seed.doc, focus: props.seed.focus });
  }, [props.seed]);

  // A new look: the theme, the accent, larger text.
  useEffect(() => {
    const look = JSON.stringify(props.look);
    if (!ready.current || look === sentLook.current) return;
    sentLook.current = look;
    deliverRef.current({ type: "look", look: props.look });
  }, [props.look]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!shown.current) fail("The editor didn't start");
    }, START_LIMIT_MS);
    return () => clearTimeout(timer);
    // Once, as the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { receive, restart };
}

/** A message as a line of script for the page: `clarityEditor.receive({...})`. */
export function asScript(receiver: string, message: ToPage): string {
  // JSON is a JavaScript expression, but for two line separators older
  // engines don't take inside a string.
  const json = JSON.stringify(message).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `window.${receiver}&&window.${receiver}.receive(${json});true;`;
}
