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
- **Photos on the server (2026-10-09; server migration 017, docs/photos-server.md section 9 in the server's repo).** Nothing shows until the server says photos are on.
  - `api/attachments.ts` (new): `getAttachmentUsage`, `postAttachmentStart`, `postAttachmentConfirm`, `postAttachmentsView`, `postAttachmentDelete`, the same shape as `notes.ts`; errors carry the server's `code`.
  - `hooks/useAttachments.ts` (new): `usePhotosEnabled()`, the `["attachments-usage"]` query (fresh for 10 minutes). The Photo tool shows in account notes only once it says `enabled`; a 404 (a server without photos), an error or not knowing yet hides it. `PHOTOS_ON_WEB` turns it off in the web build alone if the bucket won't keep a CORS rule.
  - `api/notes.ts`: the update body takes `removedPhotos` (the photos the writer took out); create and update answer `{ note, missingPhotos? }`. Bodies are sent as given, never parsed against a schema, so no field is stripped.
  - `api/account.ts`: `AccountExport` gains `photos`, `photoLinksExpireAt` and `photoLinksNote` (optional: an older server has none).
  - `sync/outbox.ts`:
    - a new operation `photo.upload` (`{ id, width?, height? }`, no bytes), subject `photo:<id>`: it never folds, isn't queued twice, and a note's delete leaves it (a photo can be in several notes);
    - `Entry.photo` (`notBefore`, `failures`, `put`, `waitingForRoom`) is stored with the queue;
    - `removedPhotos` on `note.update` is bookkeeping like `changedAt`: it never stops a fold, a create drops it, two updates' lists are joined;
    - `photoFailure` judges a photo's failure: a 404 is tried again (only the phone's own 410 is "gone"), `PHOTOS_UNAVAILABLE` waits 15 minutes, a full account 60 (or until there's room), `TOO_LARGE`, 422 and other 4xx are refused;
    - `mainHead`, `nextPhotoEntry`, `nextPhotoTime` and `countPending`, the pure queue reads `store.ts` uses. All tested by `src/data/outbox.test.ts`.
  - `sync/store.ts`: `head()` skips photos; `nextPhoto(now)`, `nextPhotoAt()`, `patchPhoto(seq, progress)`, `photoEntries()`; `pendingCount({ photos: false })` leaves photos out.
  - `sync/cache.ts`: lists load while only photos are waiting (`pendingCount({ photos: false })`): a photo can't change a list.
  - `sync/runner.ts`: a second lane for photos, one at a time, each tried no sooner than its stored `notBefore` (waking the lane, which every save does, never hurries it), through `editor/photoUpload.ts`. A saved note's `missingPhotos` that this phone has go up too. The main lane's refresh-when-empty ignores photos. `checkPhotoRoom()` lets photos waiting for space go once `usage` shows room.
  - `sync/SyncProvider.tsx`: loads `editor/photoLedger.ts` with the outbox; coming back to the app also calls `checkPhotoRoom()`; `usePendingCount({ photos: false })`.
  - `sync/persist.ts`: `"attachments-usage"` is kept on the phone; `clearOfflineData` also deletes the phone's photos (`photoStore.clearAll`), forgets those shown (`forgetPhotos`) and clears the ledger. Sign-out warns first about changes and photos not yet on the server (`app/settings.tsx`).
  - `providers/AuthProvider.tsx`: `logout` calls `signOut(() => {})`, a callback in place of Clerk's redirect. On the web that redirect is a full page load, which could cut off `clearOfflineData` and leave photos in IndexedDB (photo-account.mjs step 11, about 1 run in 4). The app's own routing shows the welcome screen, as on the phone.

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

## Photos (2026-10-09)

Photos came to both editors together, so neither opens a note with a photo blank. An editor that doesn't know a node type drops the note's whole rich text and shows an empty page, and its next save writes that over the note (the main app's editor did exactly this before the change).

- `editor/extensions.ts` and the main app's `mobile/src/editor/NoteEditor.tsx` gain the same code:
  - `Photo`: Tiptap's image as a block, pasted in only from `attachment:` addresses;
  - `liftPhotos`: each photo on a line of its own when a note is read from Markdown;
  - `backspaceUnderPhoto`: Backspace under a photo chooses it first;
  - `writeUnderChosenPhoto`: typing with a photo chosen writes under it.
- `editor/main.ts` draws photos (`PhotoView`), asking the app for each one by id (`needPhotos` and `photos` in `src/editor/protocol.ts`), and puts one in with `insertPhoto`.
- The main app shows each photo's place as an outline: it keeps no photos yet.
