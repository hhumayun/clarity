import { onlineManager } from "@tanstack/react-query";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { EditorCommand, EditorCursor, EditorFormats, EditorLook, FromPage, ToPage } from "./protocol";

/** What the editor takes in: the note, again whenever `key` changes. */
export type EditorSeed = { key: string; markdown: string; doc: unknown; focus: "end" | null };

/**
 * The note not read yet. The editor can start while the phone reads it (a
 * page that's ready sooner shows the words sooner); nothing goes in until a
 * real seed comes. The editor page ignores this key too.
 */
export const NO_SEED_YET: EditorSeed = { key: "boot", markdown: "", doc: null, focus: null };

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
  /** A checklist row ticked by a tap (true) or unticked (false). */
  onTicked?: (on: boolean) => void;
  /** Words from the strip went in: the text now before the cursor, and how many characters went in. */
  onInserted?: (before: string, length: number) => void;
  /** Where a photo in the note can be shown from, by its id (src/editor/photos.ts), or null when this phone doesn't have it. */
  photoSource?: (id: string) => Promise<string | null>;
  /**
   * Account notes: fetches a photo this phone hasn't got from the server
   * (src/editor/photos.ts, `fetchPhoto`), or null. One not there yet is
   * asked for again on reconnecting and every 30 seconds while the note is open.
   */
  photoFetch?: (id: string) => Promise<string | null>;
  /** The note is on screen. */
  onShown?: () => void;
  /** The page didn't start, or broke before showing the note. */
  onFailed?: (reason: string) => void;
};

// A page that hasn't shown the note this long after having it isn't going to.
const START_LIMIT_MS = 8_000;
// A photo this phone hasn't got, and the server hadn't either: asked for again this often while the note is open.
const PHOTO_RETRY_MS = 30_000;

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
  // Photos the page shows as outlines that the server may yet have: asked for again (photoFetch).
  const photosToRetry = useRef(new Set<string>());
  // Answered with null already: another null changes nothing on the page, so isn't sent.
  const answeredNull = useRef(new Set<string>());

  /** Asks the server for photos this phone hasn't got, and sends each to the page as it comes. */
  const fetchPhotos = (ids: string[]) => {
    const fetch = latest.current.photoFetch;
    if (!fetch) return;
    for (const id of ids) {
      void fetch(id)
        .catch(() => null)
        .then((src) => {
          if (src) photosToRetry.current.delete(id);
          else photosToRetry.current.add(id);
          // Each one as it answers: a photo draws, or (first time) its outline shows.
          if (ready.current && (src || !answeredNull.current.has(id))) deliverRef.current({ type: "photos", sources: { [id]: src } });
          if (src) answeredNull.current.delete(id);
          else answeredNull.current.add(id);
        });
    }
  };

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
          sentSeed.current = current.seed.key;
        } else if (current.seed.key !== NO_SEED_YET.key) {
          deliverRef.current({ type: "seed", seed: current.seed.key, markdown: current.seed.markdown, doc: current.seed.doc, focus: current.seed.focus });
          sentSeed.current = current.seed.key;
        }
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
        // A photo taken out of the note isn't asked for again.
        if (photosToRetry.current.size) {
          for (const id of photosToRetry.current) if (!message.markdown.includes(`attachment:${id}`)) photosToRetry.current.delete(id);
        }
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
      case "ticked":
        current.onTicked?.(message.on);
        break;
      case "inserted":
        current.onInserted?.(message.before, message.length);
        break;
      // The note's photos the page has nothing to show for: each found, or null, and answered together.
      // Account notes go on to ask the server for the rest, each sent as it comes (photoFetch).
      case "needPhotos": {
        const find = current.photoSource;
        const fetchLater = !!current.photoFetch;
        void Promise.all(message.ids.map(async (id) => [id, find ? await find(id).catch(() => null) : null] as const)).then((found) => {
          const here = fetchLater ? found.filter(([, src]) => src) : found;
          if (ready.current && here.length) deliverRef.current({ type: "photos", sources: Object.fromEntries(here) });
          if (fetchLater) {
            const ids = found.filter(([, src]) => !src).map(([id]) => id);
            for (const id of ids) answeredNull.current.delete(id);
            fetchPhotos(ids);
          }
        });
        break;
      }
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

  // The note, once it's read, and any new copy of it (the server's, a restored draft, a new question).
  useEffect(() => {
    if (!ready.current || sentSeed.current === props.seed.key || props.seed.key === NO_SEED_YET.key) return;
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

  // Photos the server hadn't got: asked for again on reconnecting, and every
  // 30 seconds while the note is open, so one that lands meanwhile appears.
  const fetching = !!props.photoFetch;
  useEffect(() => {
    if (!fetching) return;
    const retry = () => {
      const ids = [...photosToRetry.current];
      if (ids.length && onlineManager.isOnline()) fetchPhotos(ids);
    };
    const timer = setInterval(retry, PHOTO_RETRY_MS);
    const unsubscribe = onlineManager.subscribe((online) => {
      if (online) retry();
    });
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
    // fetchPhotos reads only refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetching]);

  // Counted from when the note is there to show: a slow read isn't the editor's.
  const hasNote = props.seed.key !== NO_SEED_YET.key;
  useEffect(() => {
    if (!hasNote) return;
    const timer = setTimeout(() => {
      if (!shown.current) fail("The editor didn't start");
    }, START_LIMIT_MS);
    return () => clearTimeout(timer);
    // Once, when the note first comes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNote]);

  return { receive, restart };
}

/** A message as a line of script for the page: `clarityEditor.receive({...})`. */
export function asScript(receiver: string, message: ToPage): string {
  // JSON is a JavaScript expression, but for two line separators older
  // engines don't take inside a string.
  const json = JSON.stringify(message).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `window.${receiver}&&window.${receiver}.receive(${json});true;`;
}
