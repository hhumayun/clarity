import React, { useLayoutEffect, useRef } from "react";
import { asScript, useEditorBridge, type NoteEditorProps } from "./bridge";
import { EDITOR_PAGE } from "./page";
import { PAGE_RECEIVER, type ToPage } from "./protocol";

export type { EditorSeed, NoteEditorHandle } from "./bridge";

/**
 * The web build's editor: the same page in an iframe. It shares this page's
 * origin (srcdoc), so messages go in by calling the page directly, and come
 * back through postMessage (editor/main.ts, `send`).
 */
export function NoteEditorView(props: NoteEditorProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const deliver = (message: ToPage) => {
    const page = frame.current?.contentWindow as (Window & Record<string, { receive?: (m: ToPage) => void } | undefined>) | null | undefined;
    const receiver = page?.[PAGE_RECEIVER];
    if (receiver?.receive) receiver.receive(message);
    else if (page) (page as unknown as { eval: (code: string) => void }).eval(asScript(PAGE_RECEIVER, message));
  };
  const { receive } = useEditorBridge(props, deliver);
  const receiveRef = useRef(receive);
  receiveRef.current = receive;

  // Listening before the page can speak: set up as the iframe goes in, not after paint.
  useLayoutEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const text = (event.data as { sageEditor?: unknown } | null)?.sageEditor;
      if (typeof text === "string") receiveRef.current(text);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <iframe
      ref={frame}
      srcDoc={EDITOR_PAGE}
      // Loaded, the page is up: if its "ready" went before anyone listened,
      // it's taken from here (a second one only sends the same look and note again).
      onLoad={() => {
        const page = frame.current?.contentWindow as (Window & Record<string, unknown>) | null | undefined;
        if (page?.[PAGE_RECEIVER]) receiveRef.current(JSON.stringify({ type: "ready" }));
      }}
      title="Note"
      style={{ flex: 1, width: "100%", height: "100%", border: 0, display: "block", background: props.look.colors.card }}
    />
  );
}
