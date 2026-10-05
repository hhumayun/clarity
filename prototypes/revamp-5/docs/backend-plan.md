# Wiring revamp 5 ("Sage") to Clarity: a plan

**Goal:** turn revamp 5 from a sample-data prototype into a working Clarity client. It should have real accounts, the user's own notes, tasks and areas, offline use that never loses a word, the rich-text editor, AI help and reminders, all inside Sage's design.

**How:** carry over the main app's non-visual layer (`/root/projects/clarity/mobile/src`), which already does all of this, and connect it to Sage's screens through a thin adapter, so the screens barely change.

This plan rests on two read-only surveys of the main app and the server, taken on 2026-10-05 from the files on disk, including the other session's uncommitted rich-text work.

---

## 1. What already exists, and what it means for revamp 5

**The server** (Hono, `/root/projects/clarity/server.ts`)
- **Routes:** 34 routes under `/_api`, GET and POST only.
- **Wire format:** superjson in both directions, and plain JSON bodies fail. Dates in some fields must be tagged as Dates.
- **Accounts:** Clerk. The server has no sign-up or password endpoints. The app signs people up and in with Clerk directly and sends its session token (`Authorization: Bearer …`). A user's row is created on their first request.
- **Environments:** there is **one, production** (`clarity-notes-production.up.railway.app`), with its database on Neon. There is no staging. **Wiring revamp 5 in means working against real data**, which is why decision A exists.
- **Sync:** no incremental sync. Lists come back whole, and the notes list pages by creation date and caps unpaged lists at 200. Client-made ids are accepted (replays are safe). The last write wins, field by field.
- **AI:** OpenRouter, all on the server. Suggestions, Find tasks, task summaries, first steps, title ideas and indexing are all endpoints.
- **Reminders:** stored as task fields only. There's no push and no scheduler on the server; the phone schedules local notifications.

**The main app** (`/root/projects/clarity/mobile`). Every piece below runs in plain Expo Go.

| Piece | Where | What it does |
|---|---|---|
| API client | `src/api/*`, `src/types.ts` | superjson fetch with the Clerk token; one function per endpoint |
| Accounts | `app/_layout.tsx`, `src/providers/AuthProvider.tsx`, `app/(auth)/*`, `src/ui/GoogleSignInButton.tsx`, `app/(app)/onboarding.tsx` | `ClerkProvider` with a secure-store token cache. Email and password sign-up with a code sent by email; Google sign-in; a session query that survives offline; a three-step welcome |
| Server data | `src/hooks/useNotes.ts`, `useTasks.ts`, `useFocus.ts`, `usePreferences.ts` | TanStack Query with local-first writes: the cache is patched at once and the change is queued |
| Offline | `src/sync/*` (outbox, store, runner, cache, persist, SyncProvider), `src/sync/network.ts` | the queue of unsent changes, kept per user, sent in order with backoff. Reads never overwrite unsent work. The query cache is kept on the phone for 30 days |
| Note safety | `src/lib/localDrafts.ts`, `src/lib/noteDocs.ts`, the save flow in `app/(app)/note/[id].tsx` | drafts written every second; the rich text kept per note; careful rules for when the server's copy may replace what's on screen |
| Editor | `src/editor/NoteEditor.tsx` (uncommitted), the `BootedNoteEditor` wrapper in `note/[id].tsx` | Tiptap in a web view (an Expo DOM component), writing Markdown plus Tiptap JSON. The app drives it with `run(...)` |
| Reminders | `src/lib/reminders.ts`, `reminderRules.ts`, `notifications.ts`, `focusAlerts.ts`, `src/providers/Reminders.tsx` | local notifications with Done and Snooze; repeating tasks roll forward on the phone |
| Pure logic | `src/lib/dates.ts`, `taskDates.ts`, `notesList.ts`, `noteTitle.ts`, `taskSort.ts`, `taskLinks.ts`, `movedFrom.ts` | ports as is |

**What revamp 5 has now:**
- one zustand store with sample data (`src/store/*`) that every screen reads;
- its own quick-add date reader (`src/lib/parseTask.ts`, with tests). The main app also reads dates on the phone (`dueDate.ts`, with chrono-node; the server's `tasks/parse` is only kept for old clients). So Sage's reader stays and quick add needs nothing from the server;
- no network, no accounts, no persistence;
- a mock note page (blocks rendered as Text, with plain text inputs for new notes).

---

## 2. The approach

1. **Carry over, don't rewrite.**
   - Copy the main app's non-visual modules into revamp 5 under `src/core/` (api, sync, hooks, lib, editor, providers), keeping their behaviour.
   - Record each file's source commit at the top of `src/core/SOURCE.md`, so later fixes in the main app can be brought across.
   - The offline layer (outbox, cache patching, `unlessSyncing`) goes over **as one piece**: moving half of it would break offline edits.
2. **An adapter between the API and Sage's screens.**
   - Sage's components read a small view model: a task's `area`, `day`, `time`, `remind`, `repeat` and `done`; a note's `excerpt`, `day`, `time` and `area`.
   - `src/model/` maps the API's records to that shape and back, so most screens change only where they read data, not how they draw it.
3. **Keep the sample data as Demo mode.**
   - The current store becomes `src/demo/`, behind a switch in Settings (and the default when signed out).
   - Design reviews and the screenshot tests keep working without an account.
4. **Stay in Expo Go.** Everything needed runs there. Revamp 5 has no `expo-dev-client`, so `npx expo start` already targets Go. A development build can come later, if it's ever needed.

---

## 3. Mapping Sage's data to the API

| Sage (today's store) | API | Notes |
|---|---|---|
| Area `{name, hue}` | Project `{id, name}` | Sage keys areas by name; switch to `projectId` inside the adapter. Creating an area can come back with **a different id** (same name exists), so the outbox remaps it, as the main app does |
| Task `area` | `projectId` / `projectName` | Every task needs an area (the server column is NOT NULL); quick add already defaults one |
| Task `day` (`yyyy-mm-dd`) | `completeBy` (a Date at local noon) | Convert with the main app's `taskDates` helpers |
| Task `time` (minutes) | `dueTime` (`"HH:MM"`) | Clearing the day also clears the time (server rule) |
| Task `remind`, `repeat` | `remindBefore`, `remindRepeat` | Same meaning |
| Task `done`, `doneAt` | `status: "done"`, `updatedAt` | "Done today" uses `updatedAt` once done; there is no done-at field |
| Task `details` | `description` | |
| Task `noteIds`, `foundIn` | `noteIds`, `noteId` | |
| Task `movedFrom` | none; kept on the phone (`movedFrom.ts`) | Catch up's "moved from" doesn't sync between devices, same as today |
| Note `title`, `blocks`, `excerpt` | `title`, `content` (Markdown), `doc` (Tiptap JSON) | The excerpt comes from `plainText(content)`. The blocks disappear: the editor renders the note |
| Note `area` (one) | `projectIds` (up to 20) | **Design question:** show the first area on cards and let the area sheet pick several, or keep one area per note in Sage? |
| Note `day`, `time` | `createdAt` | |
| Note `source: "focus"` | `source: "focus"`, `taskId` on create | Parked thoughts |
| Focus history per task | `focus/summary` → `{sessions, totalSeconds, lastLeftOff, lastOutcome, lastEndedAt}` | `focusToday` comes from `todaySeconds` |
| Find tasks results | `tasks/extract` (suggest) + `tasks/add` (save) | Sage adds one card at a time: `tasks/add` with one task. "Not now" stays on the phone |
| How it's going | `tasks/summary` | The server returns the whole text; Sage's word-by-word reveal is drawn on the phone |
| Go deeper and Next question | `suggestions/generate` → `reflectionQuestions` | Offline, or with AI off, Sage's built-in questions stand in |
| Focus first steps | `tasks/first_steps` | Replaces Sage's fixed ideas |
| Today's page (which note answered the day's question) | none | Keep a small map on the phone (like `movedFrom`). A server field could come later |
| Accent, paper, appearance, larger text | none | Device settings in AsyncStorage, as the main app keeps its theme |
| AI on or off; personalization | device setting; `preferences` endpoint | |

---

## 4. Phases

Each phase ends with something to try on the phone and a check that it worked. Sizes: S is up to half a day, M about a day, L two days or more.

### Phase 0: groundwork (S)
- Decisions A–D (section 6).
- Environment:
  - Revamp 5's own `.env` (gitignored) with `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (the same Clerk instance as the server) and `EXPO_PUBLIC_API_BASE_URL`.
  - Google sign-in comes back to the app at `Linking.createURL("/")`. In Expo Go that's an `exp://` address built from the tunnel's, which Clerk may need to allow (see the risks).
- Dependencies, with `npx expo install` so they match SDK 57:
  - Clerk: `@clerk/clerk-expo`, `expo-secure-store`, `expo-web-browser`, `expo-auth-session`, `expo-crypto`.
  - Data: `@tanstack/react-query`, `@tanstack/react-query-persist-client`, `@tanstack/query-async-storage-persister`, `@react-native-async-storage/async-storage`, `@react-native-community/netinfo`.
  - Logic: `superjson`, `zod`.
  - Device: `expo-notifications`, `expo-keep-awake`, `expo-file-system`, `expo-sharing`.
  - Editor: `react-native-webview`, `expo-asset`, `react-native-keyboard-controller`, and the Tiptap packages pinned at 3.27.1, as the app pins them.
- Copy the modules into `src/core/` and write `src/core/SOURCE.md`. Put the sample store behind Demo mode. Add an `ErrorBoundary`.
- **Production check, read only, with your go-ahead:** confirm which server code is live and whether `notes.doc` (migration 013) exists. The editor's rich text depends on it.
- **Check:** the app starts in Demo mode exactly as it does now; `tsc` passes.

### Phase 1: accounts (M)
- **Providers:** `ClerkProvider` (token and resource caches), then `PersistQueryClientProvider`, `AuthProvider`, `SyncProvider`, then the existing theme and acknowledgement providers.
- **Route gating:**
  - A signed-out group and a signed-in group, using `Stack.Protected`.
  - Signing in or finishing onboarding replaces the history, so Back never returns to it (the skill's one-way doors).
  - Cold start waits for the session, so the sign-in screen never flashes before Today.
- **Sage-styled screens:**
  - Welcome (a picture, "Continue with Google", "Use email");
  - Sign in and Create account (white fields on the page, a full-width accent button);
  - Email code (six boxes that advance as you type, then a check that pops).
- **New:** forgot password, through Clerk's email reset code (the main app has none).
- **First run:** the main app's three-step welcome (write freely, word help, private by default), redrawn in Sage, with one added step: pick your colour and paper. Notification permission waits until it's first needed (Phase 6).
- **Settings → Account:**
  - your email;
  - Sign out, which asks in place and **warns if changes haven't synced** (the main app silently drops them);
  - Export data (`account/export`, shared as a file);
  - Personalization (`preferences`), and clearing what it has learned (`account/clear_personalization`);
  - Delete account (`account/delete`, which also removes the sign-in account), asked in place. Afterwards the phone clears its saved session and cancels reminders, two steps the main app skips.
- **Check:** create a test account, verify the code, sign out and in, sign in with Google, open the app offline with a session already saved.

### Phase 2: real data on screen (L)
- **Hooks:** `useTasks()` (every task and area), `useNotes({from, to})` for the week Today shows (plus the weeks either side, prefetched), `useNotesPages` for the Notes tab, `useFocusSummary`, `useTaskNotes`, `useTaskSummary`.
- **Adapters** (section 3) turn records into Sage's view model. The selectors (`openOn`, `doneOn`, `slipped`, `groupTasks`, `noteGroup`) keep working on that model.
- **Screens move off the store** one at a time, with Demo mode kept working throughout:
  - Today: tasks, notes and the week's marks;
  - Notes: paged, with the area filter as `projectId`;
  - Life Center: everything grouped by when;
  - Search: server search for notes (`notes/list?q=`, which also matches area names), tasks filtered on the phone, and cached lists when offline;
  - Task page; Catch up (slipped tasks).
- **States:**
  - card-shaped placeholders that match each screen's layout while it loads;
  - the existing pictures for empty lists;
  - errors said plainly in place, never a full-screen spinner.
- **Sample content:** a small script fills a test account with the same notes and tasks as revamp 5's sample data, so screenshots and checks stay comparable.
- **Check:** every screen shows the test account's data. Pull to refresh works. A second device sees the same data.

### Phase 3: changes, offline (L)
- **The offline layer goes in whole:**
  - outbox (merging updates, deletes cancelling queued work, area id remapping);
  - runner (one at a time, with backoff);
  - cache patching;
  - `unlessSyncing`;
  - the saved query cache;
  - network watch;
  - per-user queue storage.
- **Every Sage action becomes a queued change:**
  - Tasks: add (quick add), tick and untick (a repeating task rolls forward), move (Catch up, the menu, the date sheet), edit, delete, link and unlink.
  - Areas: create, rename, remove (move tasks or remove them).
  - Notes: create, edit, archive, delete, change areas.
  - Focus: sessions (`focus.record`), and parked thoughts (a note create with `source:"focus"` and `taskId`).
  - Find tasks: Add (`tasks/add`).
  - Clear done (`tasks/clear_done`).
- **Offline, the Sage way, with no counts:**
  - a quiet capsule ("Offline. Changes will sync."), never "3 changes";
  - "Saved on this phone" on a note while it waits;
  - a small cloud mark on anything not yet sent.
  - Acknowledgements ("Moved to Tomorrow") keep coming from the capsule that already exists.
- **Conflicts** follow the main app's rules: the last write wins on the server, but the phone never replaces what you're looking at while you have unsent changes to it.
- **Check:**
  - in airplane mode, add, tick, move and write, then reconnect: everything arrives once, in order;
  - kill the app while offline: nothing is lost;
  - a create that the server returns under another area id is remapped.

### Phase 4: the editor (L)
- **What comes over:** `NoteEditor` (Tiptap in a DOM component), the `BootedNoteEditor` wrapper (the first props stay empty until the page is up, to work around the WebView escaping problem), `localDrafts`, `noteDocs` and the note screen's save rules:
  - save 900 ms after typing stops, and on leave, background or tab switch;
  - flush the editor on leave;
  - the draft wins over the server's copy if it's newer;
  - the server's copy only replaces the page when you haven't typed.
- **Sage styling** through the editor's props and CSS:
  - Nunito Sans through `expo-asset`;
  - Sage's page and ink colours;
  - the accent for the caret and links;
  - quotes drawn as Sage's accent questions;
  - checklist boxes drawn like `CircleCheck`.
- **Sage's note page stays:**
  - the area chip (a sheet that can pick several areas, if decided in section 3);
  - the small-capital date line and the title field;
  - the tools row mapped to `run(...)`: text styles, checklist, list, link, indent and outdent (the image tool waits for photos in the main app's plan);
  - Tasks and Done.
- **Writing to questions:**
  - Today's card opens a new note with its question as the first quote. "Next question" inserts another as a quote (`run("insertQuestion")`).
  - The questions come from `suggestions/generate`, with Sage's built-in ones when offline or with AI off.
  - "Go deeper" at the end of a note uses the same questions.
  - Word suggestions (completions and sentence starters) come in Phase 5, or later.
- **Rich text needs `notes.doc` live** (decision C). Until then the editor still works on Markdown alone: notes keep their formatting as Markdown, but lose the rich-only parts (indents on headings and lists).
- **Tidying:** turn off the editor's `TRACE` logging and keep perf logging to development.
- **Check:**
  - the main app's editor tests (`tests/note-editor`, about 75 checks) run against revamp 5's dev server;
  - on the phone: typing, the keyboard, the cursor kept in view, lists and checklists, Backspace at an item's start, links;
  - leave mid-sentence, kill the app, come back offline: the words are there.

### Phase 5: AI help and focus (M)
- **Find tasks:**
  - `tasks/extract` waits for the note to sync first, then shows the results as Sage's cards (Add becomes a check);
  - it runs automatically the first time a note's tasks open, as the main app does.
- **How it's going:** `tasks/summary`, cached, read while offline, shown with Sage's dots and word-by-word reveal.
- **Focus:**
  - first steps from `tasks/first_steps`;
  - sessions recorded with `focus/record`;
  - end alerts as local notifications;
  - the chime and keep-awake as in the main app.
- **Title ideas** (`notes/suggest_title`) are applied quietly when you leave a note with no title. **Indexing** (`notes/reindex`) runs after edits. Accepted suggestions are logged (`suggestions/event`).
- **AI errors stay calm:** out of credits, or too many requests, gives a quiet message. Offline, the AI buttons step back rather than fail.
- **Check:** each AI action works on the test account, and degrades gracefully offline and when the AI is busy.

### Phase 6: reminders (S–M)
- **What comes over:** the reminders code as is:
  - local notifications, at most 50 waiting, repeating tasks scheduled up to six times ahead;
  - Done and Snooze buttons on each reminder;
  - a tap opens the task.
- **When it asks permission:** the first time a reminder is set, or focus starts.
- Sage's reminder sheet already speaks the same model (`remindBefore`, `remindRepeat`).
- **Check:** a reminder fires on the phone in Expo Go; Done from the notification ticks the task; Snooze moves it an hour.

### Phase 7: hardening (M)
- **Checks:**
  - the web-based interaction checks (`interact.js`), run against the test account as well as Demo mode;
  - the scan for counts;
  - light and dark screenshots.
- **On the phone:** slow network, airplane mode, sign out with unsynced changes, two devices, large text, Reduce Motion.
- **Performance:** check on a release build before anything ships. Expo Go hides jank.
- **Decide the end state** (section 7).

**Order and size:** 0 → 1 → 2 → 3 are the spine; 4, 5 and 6 can follow in any order once 3 is in. Roughly two weeks of focused work in total, with the editor and the offline layer the largest pieces.

---

## 5. Risks and how they're handled

| Risk | Handling |
|---|---|
| **Only production exists**, so mistakes touch real data | Build against a **separate test account** (every query is scoped to the signed-in user). Never run migrations or seeding from here. The production check stays read only, and only with your go-ahead. The real account comes once Phase 3's checks pass |
| **The main app is changing under us.** The uncommitted rich-text work in `/root/projects/clarity` touches 18 files: the three note endpoints, and on the phone the offline layer (`persist.ts`, `outbox.ts`), `localDrafts`, `notesList`, the notes API and hooks. The editor and its tests are new, unsaved files | Copy Phases 0–3 from the last commit (13e5a79). Bring the rich-text changes across in Phase 4, once they're committed. Record sources in `SOURCE.md` and bring later fixes across deliberately |
| **Rich text depends on `notes.doc`** (migration 013, not yet confirmed live) | Decision C; Markdown-only works meanwhile. Sending `doc` to a server without it is harmless: unknown fields are dropped |
| **superjson and Clerk details** | Use the main app's client and `AuthProvider` unchanged; Phase 1's checks cover token refresh and offline start |
| **No incremental sync** (whole lists; notes capped at 200 unpaged) | Today asks for the visible week's notes, the Notes tab pages, and Search asks the server |
| **Some data lives on the phone only** (moved-from dates, today's page, Sage's settings) | Said in Settings' small print. Server fields can come later if they matter across devices |
| **Google sign-in in Expo Go** comes back through an `exp://` address, and the quick tunnel's address changes on every restart | Email sign-in works regardless. Test Google once on a stable address (a named tunnel), allowed in Clerk if it asks |
| **Memory on this machine** (Metro, tests and other servers share 5.4 GB) | Same habits as now: one Metro, fresh browser tabs per check, web exports for screenshots |

---

## 6. Decisions to make before Phase 0

- **A. Which data to build against:**
  - (Recommended) production with a test account, then your real account once offline is proven;
  - a new staging setup (a Railway environment, a Neon branch, the same Clerk instance), which adds about a day and some cost;
  - your real account from the start.
- **B. Where the shared code lives:**
  - (Recommended) copy into revamp 5's `src/core/` with recorded sources;
  - a shared package used by both apps, which changes the main app while another session is working in it;
  - instead, port Sage's design into the main app, the reverse direction.
- **C. Rich text:**
  - (Recommended) start Markdown-only and switch rich text on once the `doc` work is deployed;
  - wait for it before Phase 4.
- **D. Notes in several areas:**
  - (Recommended) let a note have several areas, as the server allows: cards show the first, and the sheet picks several;
  - keep one area per note in Sage.

## 7. After this: the end state

When revamp 5 works against real data, choose how it reaches the App Store:
- **(a)** it becomes the app: same EAS project, bundle ids and Clerk instance, replacing `mobile/`;
- **(b)** its screens and tokens move into `mobile/`, following DESIGN.md's porting order.

Phase 7's findings should settle it. Either way the backend needs nothing new for this plan, apart from the `doc` migration already in progress.
