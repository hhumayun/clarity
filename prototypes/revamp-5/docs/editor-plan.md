# Rich-text notes in revamp 5: a plan

**Goal:** writing in Sage the way the main app writes. Headings, bold, italic and strike; lists that nest; checklists you can tick; quotes; links; indents. Sage's questions become part of the note, and every word is safe offline. All of it drawn in Sage's design.

This is phase 5 of `docs/backend-plan.md`, worked out against the main app's code on 2026-10-06 (commit 4344bd8).

**Decided on 2026-10-06:** the editor's page is built into the app, rather than loaded as an Expo DOM component the way the main app does it (section 2). Section 9 sums up the other options considered.

**Progress (2026-10-06): built and checked in the web build; the phone test is next.**
- The page is in `editor/`, built into `src/editor/page.ts` (540 KB, with Nunito Sans inside). The app talks to it over `src/editor/protocol.ts`; on the web build the same page runs in an iframe.
- The main app's editor tests run against the built page: all 75 pass, with 7 more for Sage's questions (`tests/editor`).
- **The note page, demo mode, 18 checks in the web build:**
  - a sample note opens with its checklist and question;
  - words added are kept;
  - a new note is made with the tools;
  - Today's question opens with the cursor under it, and Next question adds another;
  - a page with only its question isn't saved;
  - nothing is sent to the server.
- **The note page, as the test account against the live server, 12 checks:**
  - a note is made once, as the right Markdown with its rich text;
  - reopened, it uses the rich text (a list moved in stays moved in);
  - a tick is saved with its rich text and its time;
  - Delete in its menu removes it;
  - every other note is left exactly as it was.
- **Found on the way: the server stores rich text twice-encoded.**
  - Every note's rich text so far (all 10 on the server) is a quoted string inside the JSON column. The cause: the create and update endpoints hand the database driver a JSON string, which it encodes again.
  - The main app treats a string as no rich text, so it has always opened server copies from their Markdown; anything only the rich text keeps (a list moved in) is lost after a reload.
  - Sage reads both forms (`asDoc`).
  - A server fix is on the branch, not deployed: writes go in as text and become JSON once (checked on a temporary table), and reads unwrap old strings (`readableDoc`). `migrations/015_note_doc_objects.sql` unwraps the 10 stored copies in place. Both wait for your OK.

---

## 1. What the main app has

- **The editor** (`mobile/src/editor/NoteEditor.tsx`, about 960 lines):
  - Tiptap 3.27.1 running in a web page inside the app (an Expo "DOM component").
  - It reads and writes a note as Markdown (what search, the AI and previews read) plus Tiptap's own rich document (`doc`, which keeps what Markdown can't, like an indented heading).
  - The app drives it with commands: `run("bold")`, `run("task")`, `run("link", url)`, `run("indent")`, `run("insertText", …)`, `run("insertQuestion", …)`, `run("flush")`.
  - It reports back: the text (`onChange`, after a pause in typing and at least every second), the formats under the cursor for the toolbar (`onState`), and the words around the cursor for word help (`onCursor`).
- **Its fixes for real problems, already found and solved:**
  - Backspace at the start of a list item;
  - empty and ticked checklist rows;
  - indents that survive Markdown;
  - the start-up wrapper (`BootedNoteEditor`), which keeps a note from failing to load when its first text holds a line break or a backtick, and makes sure commands reach the editor on screen. This one exists only because of how DOM components pass their first props and refs.

  About 75 browser tests cover the editor (`tests/note-editor`).
- **The note screen's save rules** (inside `app/(app)/note/[id].tsx`, about 1,570 lines with its own UI):
  - A new note gets its id at once. Its words are kept on the phone as a draft at most every second, and sent to the server 900 ms after typing stops.
  - Leaving the note, switching tab or going to the background sends at once. A draft newer than the server's copy wins.
  - The server's copy only replaces the page while you haven't typed.
  - A note with no title is offered one after a pause. The note is re-indexed for word help after edits.
- **Already in revamp 5:** the drafts (`localDrafts`), the per-note rich copies (`noteDocs`), the note hooks and the outbox, all copied in phases 0–4.

## 2. The approach

1. **The main app's editor, with its page built into the app.**
   - **The editor comes over:** Tiptap 3.27.1, its extensions and its fixes.
   - **Its page is built ahead of time** into one self-contained HTML file, fonts included, and shipped inside the app's code. A plain web view (`react-native-webview`, included in Expo Go) loads it from memory.
     - So a note opens and edits offline everywhere: Expo Go, dev builds and release builds alike.
     - In the main app, by contrast, the page comes from the development server while developing, so a note opened offline there can't load its editor.
   - **A small message channel** replaces the DOM component's props and commands:
     - the page says when it's ready, and the note goes in then (anything sent earlier waits);
     - changes come back after a pause in typing and at least every second, as now;
     - the formats under the cursor come back for the tools row, and the words before the cursor for word help later;
     - commands go in: formats, lists, indent, link, insert text, insert a question, flush.
   - **What it leaves out:** the main app's setup has two parts that caused trouble.
     - `useDOMImperativeHandle` carries the commands, and Expo's docs say to "expect the behavior to be flakey and possibly phased out".
     - The start-up wrapper was needed for the note's first text.
   - **Local changes,** listed in `src/core/SOURCE.md`:
     - **Questions as quotes.** `insertQuestion` adds a quote, not a plain paragraph. Sage draws quotes as questions in your colour, and the main app reads them as quotes too.
     - **Sage's look,** in the page's own styles: quotes as questions, round checklist ticks like the task check, links in your colour, Nunito Sans.
     - **Debug logging off.** The editor's `TRACE` logging is switched off.
   - **Building it:** the page's source lives in `editor/`, with its own small build (Vite and vite-plugin-singlefile). `npm run editor` rebuilds `src/editor/page.ts`. That file is committed, so Metro and app builds need no extra step.
2. **Lift the save rules out into a hook.**
   - `useNoteSession(id)` takes everything from the main app's note screen that isn't drawing: loading (draft or server copy), drafts, saves, flushing on leave and background.
   - The decision "which copy wins" becomes a pure function with its own tests.
   - Title ideas and re-indexing have a place in the hook but switch on in phase 6, with the other AI help.
3. **Sage's note page around it.** Sage keeps its own page, now with the real editor in the middle.
4. **If the page ever fails to start,** Sage shows the note read-only in today's block view, the one revamp 5 already draws from Markdown, with a way to try again. A read-only view can't save over anything, so nothing is lost.

## 3. Sage's note page with the editor

- **Top:** back, the area chip (a sheet that can pick several areas), the small-capital date line, and "Saved on this phone" while a change waits to be sent.
- **Title:** a native field, as now and as in the main app.
- **The note:** the editor, in Sage's page colour and Nunito Sans, at the body size (17/27, larger with Larger text).
  - Questions show as quotes in your colour, at the question size.
  - Checklist rows tick with a round check like the task check.
  - Links take your colour. Headings are bold.
- **The tools row,** riding on the keyboard (react-native-keyboard-controller, which Expo Go includes):
  - every button the main app has, in its order, in a row that scrolls sideways: checklist, bulleted list, numbered list, indent, outdent, bold, italic, strikethrough, heading, quote and link;
  - then word suggestions (with AI help on, from phase 6) and a button that puts the keyboard away;
  - each tool shows when it's on, from the formats the page reports.
- **Writing to Today's question:** the card opens a new page with its question as the first quote and the cursor under it. "Next question" adds another quote and moves the cursor under it. The page is saved as a `"page"` note.
- **Go deeper,** at the end of a note, inserts its question as a quote, at the end.
- **Where the questions come from:** Sage's own questions by time of day (`src/data/prompts.ts`), as now. Sage already writes them into notes as quotes (`> question`). From phase 6, with AI help on, Go deeper and Next question come from the AI, reading the note; Today's question stays Sage's own (`docs/backend-plan.md`, section 9).
- **Tasks and Done:**
  - Done flushes, saves and leaves.
  - Tasks opens the note's tasks (Find tasks follows in phase 6).
- **Archive and delete** through a small menu by the title, each asked in place. Archived notes leave the lists.

## 4. Saving and offline

- **The main app's rules, with fewer calls (changed 2026-10-06, as you asked):**
  - a draft on the phone at most every second, as before;
  - the server at most once a minute while writing, and at once on leaving the note, going to the background or opening its tasks (the main app sends 900 ms after every pause);
  - a new note is still made on the server as its first words settle, so it's never only on the phone;
  - the newer draft wins;
  - the server's copy never replaces words you're typing.
- **Nothing is said about saving on the note page:** no "Saved on this phone", no "Saved" after Done (its check says it), and no offline or "All changes saved" notices while a note is open.
- **Always sent together.** The Markdown and the rich copy go together. Words without the rich copy would clear it on the server.
- **Edit times.** Saves carry `changedAt` (phase 4), so the server's copy now carries the time of the edit rather than the time it arrived.
  - The main app's check (`applyNote`) uses the draft if it was written after the server copy's time.
  - Its new tests here include that case, so a server copy with an earlier time never wins over a draft written after it.
- **Offline:** the page is part of the app, so notes open and edit offline in Expo Go too. Only starting or reloading the app in Expo Go needs the development server.

## 5. Steps

1. **Packages** (S):
   - the Tiptap packages pinned at 3.27.1, `react-native-webview` and `react-native-keyboard-controller`;
   - Vite and vite-plugin-singlefile, to build the page;
   - Metro is stopped during the install, because this machine runs out of memory otherwise.
2. **The editor page** (M): the editor brought over; the build; the message channel with its ready handshake; Sage's styles; the main app's editor tests run against the built page.
3. **`useNoteSession`** (M): the save rules lifted out, with the "which copy wins" rules tested on their own.
4. **The page** (M):
   - Sage's note page with the editor, the tools row and the styles;
   - Today's question, Next question and Go deeper;
   - Done, archive and delete;
   - the read-only view if the page fails to start.
5. **Checks** (M):
   - **The main app's editor tests:** about 75 checks, against the built page.
   - **New browser checks, as the test account:**
     - write a note with formatting, then reopen it and check the formatting is still there;
     - tick a checklist row;
     - write to a question;
     - leave mid-sentence and reload, and check the words are kept;
     - edit offline, then reconnect and check the change arrives once, with its time;
     - Markdown-only notes from the main app open correctly.
   - **On your phone:**
     - typing, the keyboard and its tools row, the cursor staying in view;
     - lists and Backspace, links;
     - in airplane mode, a note opens and edits;
     - how long the page takes to appear.

The backend plan sizes this phase L. The page and the checks are the largest parts.

## 6. Not in this phase

- The AI pieces come in phase 6: word help, the AI's questions, title ideas, re-indexing and Find tasks. The decisions they need are in `docs/backend-plan.md`, section 9.
- Photos and dictation wait for the main app.

## 7. Risks

| Risk | Handling |
|---|---|
| Typing feel in a web page inside the app (the cursor, the keyboard, scrolling) | The main app's editor has already met these problems and fixed several. The web view is set up the way 10tap sets up its own: no keyboard accessory bar, focus from code allowed, no scrolling of its own. Phone checks at each step; the browser tests catch regressions |
| The message channel: messages lost or out of order while the page starts | A ready handshake, with anything sent earlier waiting for it; a test that sends a note before the page is up |
| A bigger page that's slower to appear, with the fonts inside | Only Nunito Sans's three weights, Latin letters only; the start-up timed on the phone |
| Losing the rich copy (indents, nesting) when only Markdown is sent | Markdown and the rich copy always go together; the read-only view can't save |
| The two apps' editors drift apart | The editor code kept as close to the main app's as possible, with the differences in `SOURCE.md`. The main app can adopt the built page later, with your OK |
| Memory on this machine during the install | Metro is stopped while packages install |

## 8. Decisions

**Decided on 2026-10-06:**
- the editor's page is built into the app;
- questions inside notes stay as Sage shows them: quotes in your colour;
- the tools row has every button the main app has.

The AI decisions, including word help, are in `docs/backend-plan.md`, section 9. With the page built in, no preview build is needed to check offline behaviour; phase 8 still checks speed on a release build.

## 9. Other options considered (2026-10-06)

- **Native editors:** react-native-enriched-html, react-native-enriched-markdown, Expensify's live-markdown and apollohg's editor.
  - They have the best typing feel, and Expo's guide recommends them for most apps.
  - But each misses something these notes use (nested lists, quotes, checklists, or inserting at the cursor), or is very new. All of them need a dev build.
  - Worth another look in a few months; they're changing quickly.
- **10tap,** which packages Tiptap much as this plan does: no release since November 2025, and an unanswered report that it never starts on newer React Native.
- **Simpler approaches:** plain Markdown with a formatted reading view isn't rich while you type. One text box per paragraph means building selection, paste and undo ourselves.
