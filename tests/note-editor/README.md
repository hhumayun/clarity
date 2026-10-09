# Note editor tests

These drive the app's note editor page (`mobile/src/editor/NoteEditor.tsx`, an
Expo DOM component) in desktop Chrome, the way the app drives it on the phone:

- its props arrive as react-native-webview hands them over, the first set
  inside a template string (a line break there once kept notes from loading);
- the app's commands go in through `run(...)`;
- what the editor calls back (`onChange`, `onState`, `onCursor`, ...) is
  captured and checked.

About 83 checks cover:
- lists and checklists: Backspace at an item's start, empty rows, ticked rows, indent and outdent;
- quotes;
- links;
- Markdown round trips and the rich text kept beside them;
- suggestions inserted at the cursor;
- how changes are batched to the app;
- row heights, and the room under a note's last line.
- photos (2026-10-09): a note with one opens and saves whole, Backspace under one, photos read from Markdown, and pastes.

## Running them

1. Start the app's dev server: in `mobile/`, `npx expo start`. The tests only
   need its web page at `http://localhost:8081`.
2. Here: `npm install` once, then `npm test`.

It exits with 0 when everything passes. A failure prints what it got and what
it wanted.

Settings, as environment variables:

| Variable | Default | What |
|---|---|---|
| `DEV_SERVER_URL` | `http://localhost:8081` | Where the dev server is |
| `EDITOR_URL` | built from the above | The editor page's full address, if it differs |
| `CHROME_PATH` | the installed Google Chrome | A Chrome or Chromium to run instead |

## What they cannot cover

They run in desktop Chrome, not in Safari on the iPhone. Behaviour only the
iPhone has is imitated with synthetic events where a test needs it, not
reproduced:
- the keyboard's compositions (autocorrect, inline predictions);
- Safari's own edits;
- Shift sent with Backspace when the keyboard is set to capitalise.

Check those on a phone with the development build. While `TRACE` is on in
`NoteEditor.tsx`, the editor logs what the iPhone sends to the dev server's
log.

Home and End are unreliable in headless Chrome, so the tests place the cursor
directly rather than with those keys.
