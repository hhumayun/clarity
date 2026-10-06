# Rich-text notes in revamp 5: a plan

**Goal:** writing in Sage the way the main app writes. Headings, bold, italic and strike; lists that nest; checklists you can tick; quotes; links; indents. Sage's questions become part of the note, and every word is safe offline. All of it drawn in Sage's design.

This is phase 5 of `docs/backend-plan.md`, worked out against the main app's code on 2026-10-06 (commit 4344bd8).

---

## 1. What the main app has

- **The editor** (`mobile/src/editor/NoteEditor.tsx`, about 960 lines):
  - Tiptap 3.27.1 running in a web page inside the app (an Expo "DOM component").
  - It reads and writes a note as Markdown (what search, the AI and previews read) plus Tiptap's own rich document (`doc`, which keeps what Markdown can't, like an indented heading).
  - The app drives it with commands: `run("bold")`, `run("task")`, `run("link", url)`, `run("indent")`, `run("insertText", …)`, `run("insertQuestion", …)`, `run("flush")`.
  - It reports back: the text (`onChange`, after a pause in typing and at least every second), the formats under the cursor for the toolbar (`onState`), and the words around the cursor for word help (`onCursor`).
- **Its fixes for real problems, already found and solved:**
  - the start-up wrapper (`BootedNoteEditor`), which keeps a note from failing to load when its first text holds a line break or a backtick, and makes sure commands reach the editor on screen;
  - Backspace at the start of a list item;
  - empty and ticked checklist rows;
  - indents that survive Markdown.

  About 75 browser tests cover this (`tests/note-editor`).
- **The note screen's save rules** (inside `app/(app)/note/[id].tsx`, about 1,570 lines with its own UI):
  - A new note gets its id at once. Its words are kept on the phone as a draft at most every second, and sent to the server 900 ms after typing stops.
  - Leaving the note, switching tab or going to the background sends at once. A draft newer than the server's copy wins.
  - The server's copy only replaces the page while you haven't typed.
  - A note with no title is offered one after a pause. The note is re-indexed for word help after edits.
- **Already in revamp 5:** the drafts (`localDrafts`), the per-note rich copies (`noteDocs`), the note hooks and the outbox, all copied in phases 0–4.

## 2. The approach

1. **Copy the editor, don't rebuild it.**
   - The Tiptap page comes over with its start-up wrapper, and the editor tests come with it.
   - Three local changes, listed in `src/core/SOURCE.md`:
     - **Questions as quotes.** `insertQuestion` adds a quote, not a plain paragraph, so a question stays a question (Sage draws quotes as questions in your colour). The main app reads them as quotes too.
     - **A slot for Sage's look.** A small `extraCss` prop, so Sage styles quotes, checklist circles, links and headings without touching the main app's styles.
     - **Debug logging off.** The editor's `TRACE` logging is switched off.
2. **Lift the save rules out into a hook.**
   - `useNoteSession(id)` takes everything from the main app's note screen that isn't drawing: loading (draft or server copy), drafts, saves, flushing on leave and background.
   - The decision "which copy wins" becomes a pure function with its own tests.
   - Title ideas and re-indexing have a place in the hook but switch on in phase 6, with the other AI help, as `docs/backend-plan.md` has it.
3. **Sage's note page around it.** Sage keeps its own page, now with the real editor in the middle.
4. **A fallback when the editor page can't load.**
   - In Expo Go, the editor page comes from the development server, so offline it can't load. (A real build carries the page inside the app; the main app recorded this on 2026-10-04.)
   - If the page isn't ready within a few seconds, or reports an error, Sage shows the note read-only in today's block view, the one revamp 5 already draws from Markdown, and tries the editor again when back online. Nothing is lost, because a read-only view can't save over the rich copy.

## 3. Sage's note page with the editor

- **Top:** back, the area chip (a sheet that can pick several areas), the small-capital date line, and "Saved on this phone" while a change waits to be sent.
- **Title:** a native field, as now and as in the main app.
- **The note:** the editor, in Sage's page colour and Nunito Sans, at the body size (17/27, larger with Larger text).
  - Questions show as quotes in your colour, at the question size.
  - Checklist rows tick with a round check like the task check.
  - Links take your colour. Headings are bold.
- **The tools row,** riding on the keyboard (react-native-keyboard-controller, which Expo Go includes):
  - **Aa** opens text styles: bold, italic, strike, heading, quote;
  - checklist, list, link, indent and outdent;
  - a keyboard-down button.
  - Each tool shows when it's on, from the editor's `onState`. The image and microphone tools go until the main app has photos and dictation.
- **Writing to Today's question:** the card opens a new page with its question as the first quote and the cursor under it. "Next question" adds another quote and moves the cursor under it. The page is saved as a `"page"` note.
- **Go deeper,** at the end of a note, inserts its question as a quote, at the end.
- **Where the questions come from:** Sage's own questions by time of day (`src/data/prompts.ts`), as now. Sage already writes them into notes as quotes (`> question`).
  - The AI's questions come from the same call as word help (`suggestions/generate`), so they come with it in phase 6.
  - That moves them one phase later than the backend plan had them.
- **Tasks and Done:**
  - Done flushes, saves and leaves.
  - Tasks opens the note's tasks (Find tasks follows in phase 6).
- **Archive and delete** through a small menu by the title, each asked in place. Archived notes leave the lists.

## 4. Saving and offline

- **The main app's rules, unchanged:**
  - a draft at most every second;
  - sent 900 ms after a pause, and at once on leave, tab switch or background;
  - the newer draft wins;
  - the server's copy never replaces words you're typing.
- **Always sent together.** The Markdown and the rich copy go together. Words without the rich copy would clear it on the server.
- **Edit times.** Saves carry `changedAt` (phase 4), so the server's copy now carries the time of the edit rather than the time it arrived.
  - The main app's check (`applyNote`) uses the draft if it was written after the server copy's time.
  - Its new tests here include that case, so a server copy with an earlier time never wins over a draft written after it.
- **Offline in Expo Go:** a note open before going offline keeps working. A note opened offline shows read-only, and returns to the editor once online. In a real build the editor opens offline too; that can be checked with an EAS preview build (one of the month's iOS builds), only if you want it.

## 5. Steps

1. **Packages** (S):
   - the Tiptap packages pinned at 3.27.1, `react-native-webview`, `expo-asset` and `react-native-keyboard-controller`;
   - Metro is stopped during the install, because this machine runs out of memory otherwise.
2. **The editor** (S): copy the editor and its wrapper; the three local changes; the main app's editor tests run against revamp 5's dev server.
3. **`useNoteSession`** (M): the save rules lifted out, with the "which copy wins" rules tested on their own.
4. **The page** (M):
   - Sage's note page with the editor, the tools row and the styles;
   - Today's question, Next question and Go deeper;
   - Done, archive and delete;
   - the read-only fallback.
5. **Checks** (M):
   - **The main app's editor tests:** about 75 checks.
   - **New browser checks, as the test account:** write a note with formatting, then reopen it and check it's still there; tick a checklist row; write to a question; leave mid-sentence and reload, and check the words are kept; edit offline, then reconnect and check it arrives once with its time; Markdown-only notes from the main app open correctly.
   - **On your phone:** typing, the keyboard and its tools row, the cursor staying in view, lists and Backspace, links, and the fallback in airplane mode.

The backend plan sizes this phase L. The page and the checks are the largest parts.

## 6. Not in this phase

- Word help (the main app's suggestion tray of completions and sentence starters) comes with the AI work in phase 6, along with the AI's questions, title ideas and re-indexing.
- Photos and dictation wait for the main app.
- Find tasks is phase 6.

## 7. Risks

| Risk | Handling |
|---|---|
| Typing feel in a web page inside the app (the cursor, the keyboard, scrolling) | The main app's editor has already met these problems and fixed several. Phone checks at each step; the browser tests catch regressions |
| Losing the rich copy (indents, nesting) when only Markdown is sent | Markdown and the rich copy always go together; the fallback is read-only |
| Expo Go can't open the editor offline | The read-only fallback; a preview build to confirm real-build behaviour, if wanted |
| The main app's editor keeps changing | Copied from 4344bd8 with versions recorded in `SOURCE.md`; later fixes brought across deliberately |
| Memory on this machine during the Tiptap install | Metro is stopped while packages install |

## 8. Decisions

1. **Questions inside notes:** as quotes in your colour (recommended; the Markdown is `> question`), or as plain paragraphs like the main app.
2. **Word help and the AI's questions, now or later:** later, with phase 6 (recommended), or bring the suggestion tray and the AI's questions now.
3. **The tools row:** Aa (styles), checklist, list, link and indent (recommended), or the main app's full row of buttons.
4. **A preview build** to confirm the editor opens offline in a real build: only if you want to spend one of the month's iOS builds.
