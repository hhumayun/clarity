# Where src/core comes from

These files are copied unchanged from the main app's `mobile/src` at commit 44abd69 (branch dev-build-editor-lab, 2026-10-05). The blob id identifies the exact version, so drift can be checked with `git rev-parse <commit>:mobile/src/<file>`.

Only `providers/ToastProvider.tsx` is new. It keeps the main app's `useToast().show(message)` and shows messages in Sage's acknowledgement capsule.

When a file here has to change, note it below the table with the reason. Bring later fixes from the main app across deliberately, and update the blob id.

| File | Blob at 44abd69 |
|---|---|
| `types.ts` | `f1bc4c9bea` |
| `api/account.ts` | `6eaf77dc95` |
| `api/apiFetch.ts` | `2235aa023a` |
| `api/focus.ts` | `93aaab598e` |
| `api/notes.ts` | `0e59075a74` |
| `api/parse.ts` | `d8218ae8d8` |
| `api/session.ts` | `605e43095f` |
| `api/suggestions.ts` | `743fbcb8c6` |
| `api/tasks.ts` | `57aa244060` |
| `sync/cache.ts` | `b7f2d018fb` |
| `sync/network.ts` | `82f33d8d1b` |
| `sync/outbox.ts` | `13e0ec1620` |
| `sync/persist.ts` | `612d84c2e8` |
| `sync/runner.ts` | `3435c51c26` |
| `sync/store.ts` | `fcc206eeb6` |
| `sync/SyncProvider.tsx` | `0ed6f4fdb0` |
| `lib/dates.ts` | `31be15ff39` |
| `lib/taskDates.ts` | `8375640444` |
| `lib/notesList.ts` | `9baa34d331` |
| `lib/noteTitle.ts` | `277e1bafe0` |
| `lib/taskSort.ts` | `6525fcdaf2` |
| `lib/taskLinks.ts` | `69016eedd0` |
| `lib/reminderRules.ts` | `3ccefc41d9` |
| `lib/reminders.ts` | `29bf6d1af1` |
| `lib/notifications.ts` | `df725dc432` |
| `lib/focus.ts` | `5828da6d8e` |
| `lib/lifeCenter.ts` | `a6ad919232` |
| `lib/localDrafts.ts` | `e2b2e6857a` |
| `lib/noteDocs.ts` | `4b619ab3ad` |
| `lib/perf.ts` | `567f975f3a` |
| `lib/focusAlerts.ts` | `e9db916245` |
| `hooks/useNotes.ts` | `d04a831c62` |
| `hooks/useTasks.ts` | `09a784a849` |
| `hooks/useFocus.ts` | `c22ba6308d` |
| `hooks/usePreferences.ts` | `ba3c978665` |
| `hooks/useSuggestions.ts` | `0786f47df8` |
| `providers/AuthProvider.tsx` | `ba96408808` |

## Local changes

Each one only adds, and is marked "(revamp 5)" in the code. They follow the API changes of migration 014 (docs/backend-plan.md, section 5).

- `types.ts`: `TaskRecord` gains `completedAt` and `movedFrom`, and a note's `source` may be `"page"` (on `NoteRecord` and `LinkedNote`).
- `lib/reminderRules.ts`: `TaskChange` gains `movedFrom`.
- `sync/outbox.ts`:
  - `task.update` carries `movedFrom` and `changedAt`; `note.update` carries `changedAt`; `note.create` may be a `"page"`.
  - `changedAt` is bookkeeping: it never stops an edit folding into an unsent create, and a create doesn't take it.
  - Folded edits keep the later time. Tested by `src/data/outbox.test.ts`.
- `api/tasks.ts` and `api/notes.ts`: the update bodies take `changedAt` (and tasks take `movedFrom`); note creates may be a `"page"`.
- `hooks/useTasks.ts`: an update is stamped with `changedAt`, and the phone's copy shows `completedAt` and `movedFrom` at once.
- `hooks/useNotes.ts`: a note update is stamped with `changedAt`; a create may be a `"page"`.
- **A reminder for this time only (`remindOnce`, 2026-10-06; server migration 016).**
  - It's on `TaskRecord` (`types.ts`), in the task create and update bodies (`api/tasks.ts`, `sync/outbox.ts`, where creates may take it), and in the tasks hook's create and cache patch (`hooks/useTasks.ts`).
  - `lib/reminderRules.ts`: `reminderTimes` gives a reminder for this time only once, though the task repeats. `withReminders` clears it (`remindBefore: null, remindOnce: false`) when a repeating task comes back. Tested by `src/data/reminders.test.ts`.
- `api/tasks.ts`: `postTaskDismissSuggestion` (2026-10-06), for "Not now" on a found task. The server already had the endpoint; the main app doesn't call it.

## The editor (phase 5, 2026-10-06)

The main app's note editor and its save rules came over at 4344bd8, outside `src/core/`:

- `editor/extensions.ts`: the editing rules from `mobile/src/editor/NoteEditor.tsx`, unchanged. Indents, Backspace at a line's start, empty checklist rows, quotes and links are all there; only the temporary tracing (`TRACE`) is left out.
- `editor/main.ts`: the rest of that file (the editor's setup, change batching, cursor and formats, commands) as a plain page. There's no React and no Expo DOM component; it's built into `src/editor/page.ts` by `npm run editor`. It differs from the main app in four ways:
  - it talks to the app over `src/editor/protocol.ts` instead of props and `useDOMImperativeHandle`;
  - `insertQuestion` adds a quote, and takes `{ text, atEnd }`;
  - Sage's look is in the page's styles, with Nunito Sans inside it as Latin-only woff2 (`editor/fonts`, OFL);
  - "Write" is the hint under a question.
- `src/editor/useNoteSession.ts`: the note screen's save rules from `mobile/app/(app)/note/[id].tsx`: loading (the list's copy, then the server's), the draft-or-server choice, drafts every second, the outbox 900 ms after a pause, flushing on leave and background. It differs in four ways:
  - a page from Today's question is saved as `"page"`;
  - a new page isn't made until it has words beyond its questions;
  - updates carry `changedAt`;
  - the server's rich text is read through `asDoc`, because the server stored it as a quoted string (see `docs/editor-plan.md`, progress).
- `tests/editor/editor.test.js`: the main app's `tests/note-editor` with its harness swapped for this page's channel. The question check expects a quote, and seven checks for Sage's questions are added.
