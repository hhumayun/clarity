# Wiring revamp 5 ("Sage") to Clarity: a plan

**Goal:** turn revamp 5 from a sample-data prototype into a working Clarity client. It should have real accounts, the user's own notes, tasks and areas, offline use that never loses a word, the rich-text editor, AI help and reminders, all inside Sage's design.

**How:**
- Carry over the main app's non-visual layer (`mobile/src`), which already does all of this.
- Connect it to Sage's screens through a thin adapter, so the screens barely change.
- Change the API a little where Sage needs it (section 5).

**Decided on 2026-10-05** (details in section 7):
- the main app's code is copied into revamp 5;
- four small API changes;
- notes can have several areas;
- a test account comes first.

The facts here were checked against the code on 2026-10-05.

**Progress:**
- **Phase 0 is done** (2026-10-05).
  - The packages are installed at the main app's versions.
  - `src/core/` holds 37 files copied unchanged from 44abd69 and type-checks as it is. `src/core/SOURCE.md` records each file's version.
  - `.env` is git-ignored. Settings are saved on the phone, and demo mode is in.
- **Phase 1 is built** (2026-10-05) and checked in the web build up to Clerk's web-only bot check.
  - Still to do on the phone: create the test account, verify the code (424242), sign out and back in, Google, and an offline start.
  - The test account's details are kept on the dev machine, outside the repo.
- **Phase 1 checked on the phone** (2026-10-05): the test account was made, and signing out and back in works.
- **Phase 2 code is written** (2026-10-05). The four changes in section 5 and `migrations/014_task_times_pages_suggestions.sql` are on the branch, and the server type-checks.
  - Next, each with your OK: apply migration 014, test on a local server, then deploy.
  - The web build can only test against a local server, because the live one doesn't accept requests from `localhost:8087`. The phone app isn't affected.
- **Later:** `@clerk/clerk-expo` 2.20 is deprecated in favour of `@clerk/expo` (Clerk's Core 3). Both apps use it; move them together.

---

## 1. What already exists, and what it means for revamp 5

**The server** (Hono, `server.ts`)
- **Routes:** 34 routes under `/_api`, GET and POST only.
- **Wire format:** superjson in both directions, and plain JSON bodies fail. Dates in some fields must be tagged as Dates.
- **Accounts:** Clerk. The server has no sign-up or password endpoints. The app signs people up and in with Clerk directly and sends its session token (`Authorization: Bearer …`). A user's row is created on their first request.
- **Environment:**
  - There is one, on Railway, called production (`clarity-notes-production.up.railway.app`), with its database on Neon.
  - The app is still in development, so this is the environment to build against. Its database does hold your own notes.
- **Deploys:** `railway up` from this machine ships the whole folder it runs in. The last deploy (3ce3894e, 3 October) added rich text: `notes.doc`, migration 013.
- **Sync:**
  - No incremental sync: lists come back whole. The notes list pages by creation date, and caps unpaged lists at 200.
  - Client-made ids are accepted, so replays are safe.
  - The last write wins, field by field.
- **AI:** OpenRouter, all on the server. Suggestions, Find tasks, task summaries, first steps, title ideas and indexing are all endpoints.
- **Reminders:** stored as task fields only. There's no push and no scheduler on the server; the phone schedules local notifications.

**The main app** (`mobile/`). Every piece below runs in plain Expo Go. All of it is now committed: the rich-text work that had sat unsaved since 4 October is checkpoint 44abd69, merged into revamp 5's branch as 32e8adf.

| Piece | Where | What it does |
|---|---|---|
| API client | `src/api/*`, `src/types.ts` | superjson fetch with the Clerk token; one function per endpoint |
| Accounts | `app/_layout.tsx`, `src/providers/AuthProvider.tsx`, `app/(auth)/*`, `src/ui/GoogleSignInButton.tsx`, `app/(app)/onboarding.tsx` | `ClerkProvider` with a secure-store token cache. Email and password sign-up with a code sent by email; Google sign-in; a session query that survives offline; a three-step welcome |
| Server data | `src/hooks/useNotes.ts`, `useTasks.ts`, `useFocus.ts`, `usePreferences.ts` | TanStack Query with local-first writes: the cache is patched at once and the change is queued |
| Offline | `src/sync/*` (outbox, store, runner, cache, persist, SyncProvider), `src/sync/network.ts` | the queue of unsent changes, kept per user, sent in order with backoff. Reads never overwrite unsent work. The query cache is kept on the phone for 30 days |
| Note safety | `src/lib/localDrafts.ts`, `src/lib/noteDocs.ts`, the save flow in `app/(app)/note/[id].tsx` | drafts written every second; the rich text kept per note; careful rules for when the server's copy may replace what's on screen |
| Editor | `src/editor/NoteEditor.tsx`, the `BootedNoteEditor` wrapper in `note/[id].tsx` | Tiptap in a web view (an Expo DOM component), writing Markdown plus Tiptap JSON. The app drives it with `run(...)` |
| Reminders | `src/lib/reminders.ts`, `reminderRules.ts`, `notifications.ts`, `focusAlerts.ts`, `src/providers/Reminders.tsx` | local notifications with Done and Snooze; repeating tasks roll forward on the phone |
| Pure logic | `src/lib/dates.ts`, `taskDates.ts`, `notesList.ts`, `noteTitle.ts`, `taskSort.ts`, `taskLinks.ts` | ports as is |

**What revamp 5 has now:**
- one zustand store with sample data (`src/store/*`) that every screen reads;
- its own quick-add date reader (`src/lib/parseTask.ts`, with tests). The main app also reads dates on the phone (`dueDate.ts`, with chrono-node; the server's `tasks/parse` is only kept for old clients). So Sage's reader stays and quick add needs nothing from the server;
- no network, no accounts, no persistence;
- a mock note page (blocks rendered as Text, with plain text inputs for new notes).

---

## 2. The approach

1. **Carry over, don't rewrite.**
   - Copy the main app's non-visual modules from checkpoint 44abd69 into revamp 5 under `src/core/` (api, sync, hooks, lib, editor, providers), keeping their behaviour.
   - Record each file's source commit in `src/core/SOURCE.md`, so later fixes in the main app can be brought across.
   - The offline layer (outbox, cache patching, `unlessSyncing`) goes over **as one piece**: moving half of it would break offline edits.
2. **An adapter between the API and Sage's screens.**
   - Sage's components read a small view model: a task's `area`, `day`, `time`, `remind`, `repeat` and `done`; a note's `excerpt`, `day`, `time` and `area`.
   - `src/model/` maps the API's records to that shape and back, so most screens change only where they read data, not how they draw it.
3. **Keep the sample data as Demo mode.**
   - The current store becomes `src/demo/`, behind a switch in Settings (and the default when signed out).
   - Design reviews and the screenshot tests keep working without an account.
4. **Four small API changes** (section 5).
   - Each only adds: new columns, a new table, a new allowed value, an optional field. The main app keeps working unchanged.
   - They ship together, in one migration and one deploy.
5. **Stay in Expo Go.** Everything needed runs there. Revamp 5 has no `expo-dev-client`, so `npx expo start` already targets Go. A development build can come later, if it's ever needed.

---

## 3. Mapping Sage's data to the API

"New" marks a field the API changes in section 5 add.

| Sage (today's store) | API | Notes |
|---|---|---|
| Area `{name, hue}` | Project `{id, name}` | Sage keys areas by name; switch to `projectId` inside the adapter. Creating an area can come back with **a different id** (same name exists), so the outbox remaps it, as the main app does |
| Task `area` | `projectId` / `projectName` | Every task needs an area (the server column is NOT NULL); quick add already defaults one |
| Task `day` (`yyyy-mm-dd`) | `completeBy` (a Date at local noon) | Convert with the main app's `taskDates` helpers |
| Task `time` (minutes) | `dueTime` (`"HH:MM"`) | Clearing the day also clears the time (server rule) |
| Task `remind`, `repeat` | `remindBefore`, `remindRepeat` | Same meaning |
| Task `done`, `doneAt` | `status: "done"`, `completedAt` (new) | The Done list and "done today" read `completedAt` |
| Task `details` | `description` | |
| Task `noteIds`, `foundIn` | `noteIds`, `noteId` | |
| Task `movedFrom` | `movedFrom` (new) | "Moved from Tue" shows on every device |
| Note `title`, `blocks`, `excerpt` | `title`, `content` (Markdown), `doc` (Tiptap JSON) | The excerpt comes from `plainText(content)`. The blocks disappear: the editor renders the note |
| Note `area` | `projectIds` (up to 20) | **Several areas:** cards show the first; the area sheet picks several |
| Note `day`, `time` | `createdAt` | |
| Note `source: "focus"` | `source: "focus"`, `taskId` on create | Parked thoughts |
| Today's page (the note that answered the day's question) | a note with `source: "page"` (new) | The day's page is the first such note written that day, so every device knows it |
| Focus history per task | `focus/summary` → `{sessions, totalSeconds, lastLeftOff, lastOutcome, lastEndedAt}` | `focusToday` comes from `todaySeconds` |
| Find tasks results | `tasks/extract` (suggest), `tasks/add` (save), `tasks/dismiss_suggestion` (new) | Sage adds one card at a time: `tasks/add` with one task. "Not now" dismisses on the server. Undecided suggestions come back with the note's tasks |
| How it's going | `tasks/summary` | The server returns the whole text; Sage's word-by-word reveal is drawn on the phone |
| Go deeper and Next question | `suggestions/generate` → `reflectionQuestions` | Offline, or with AI off, Sage's built-in questions stand in |
| Focus first steps | `tasks/first_steps` | Replaces Sage's fixed ideas |
| Edits made offline | `changedAt` on updates (new) | An edit keeps the time it was made, not the time it synced |
| Accent, paper, appearance, larger text | none | Device settings in AsyncStorage, as the main app keeps its theme |
| AI on or off; personalization | device setting; `preferences` endpoint | |

---

## 4. Phases

Each phase ends with something to try on the phone and a check that it worked. Sizes: S is up to half a day, M about a day, L two days or more.

### Phase 0: groundwork (S)
- Environment:
  - Revamp 5's own `.env` (gitignored) with `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (the same Clerk instance as the server) and `EXPO_PUBLIC_API_BASE_URL`.
  - Google sign-in comes back to the app at `Linking.createURL("/")`. In Expo Go that's an `exp://` address built from the tunnel's, which Clerk may need to allow (see the risks).
- Dependencies, with `npx expo install` so they match SDK 57:
  - Clerk: `@clerk/clerk-expo`, `expo-secure-store`, `expo-web-browser`, `expo-auth-session`, `expo-crypto`.
  - Data: `@tanstack/react-query`, `@tanstack/react-query-persist-client`, `@tanstack/query-async-storage-persister`, `@react-native-async-storage/async-storage`, `@react-native-community/netinfo`.
  - Logic: `superjson`, `zod`.
  - Device: `expo-notifications`, `expo-keep-awake`, `expo-file-system`, `expo-sharing`.
  - Editor: `react-native-webview`, `expo-asset`, `react-native-keyboard-controller`, and the Tiptap packages pinned at 3.27.1, as the app pins them.
- Copy the modules from 44abd69 into `src/core/` and write `src/core/SOURCE.md`. Put the sample store behind Demo mode. Add an `ErrorBoundary`.
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
- **First run:** the main app's three-step welcome (write freely, word help, private by default), redrawn in Sage, with one added step: pick your colour and paper. Notification permission waits until it's first needed (Phase 7).
- **Settings → Account:**
  - your email;
  - Sign out, which asks in place and **warns if changes haven't synced** (the main app silently drops them);
  - Export data (`account/export`, shared as a file);
  - Personalization (`preferences`), and clearing what it has learned (`account/clear_personalization`);
  - Delete account (`account/delete`, which also removes the sign-in account), asked in place. Afterwards the phone clears its saved session and cancels reminders, two steps the main app skips.
- **The test account:** an address with `+clerk_test` in it. Clerk's development instances (this one's key is `pk_test_…`) send no email to those and accept the fixed code 424242, so no inbox is needed, as long as the instance's test mode is on (the default).
- **Check:** create the test account, verify the code, sign out and in, sign in with Google, open the app offline with a session already saved.

### Phase 2: the API changes (M)
- The four changes in section 5, in one migration and one deploy, shipped as section 5 describes.
- **Check:**
  - each new field and endpoint works against the test account;
  - after the deploy, the main app still works on your phone: notes, tasks, Find tasks, focus.

### Phase 3: real data on screen (L)
- **Hooks:** `useTasks()` (every task and area), `useNotes({from, to})` for the week Today shows (plus the weeks either side, prefetched), `useNotesPages` for the Notes tab, `useFocusSummary`, `useTaskNotes`, `useTaskSummary`.
- **Adapters** (section 3) turn records into Sage's view model. The selectors (`openOn`, `doneOn`, `slipped`, `groupTasks`, `noteGroup`) keep working on that model.
- **Screens move off the store** one at a time, with Demo mode kept working throughout:
  - Today: tasks, notes, the week's marks, today's page (`source: "page"`), and Done by `completedAt`;
  - Notes: paged, with the area filter as `projectId`;
  - Life Center: everything grouped by when;
  - Search: server search for notes (`notes/list?q=`, which also matches area names), tasks filtered on the phone, and cached lists when offline;
  - Task page, with "moved from" from the server; Catch up (slipped tasks).
- **States:**
  - card-shaped placeholders that match each screen's layout while it loads;
  - the existing pictures for empty lists;
  - errors said plainly in place, never a full-screen spinner.
- **Sample content:** a small script fills the test account with the same notes and tasks as revamp 5's sample data, so screenshots and checks stay comparable. It never touches your account.
- **Check:** every screen shows the test account's data. Pull to refresh works. A second device sees the same data.

### Phase 4: changes, offline (L)
- **The offline layer goes in whole:**
  - outbox (merging updates, deletes cancelling queued work, area id remapping);
  - runner (one at a time, with backoff);
  - cache patching;
  - `unlessSyncing`;
  - the saved query cache;
  - network watch;
  - per-user queue storage.
- **Every update carries `changedAt`,** the time it was made. When the outbox folds several edits together it keeps the latest.
- **Every Sage action becomes a queued change:**
  - Tasks: add (quick add), tick and untick (a repeating task rolls forward), move (Catch up, the menu and the date sheet send `movedFrom`), edit, delete, link and unlink.
  - Areas: create, rename, remove (move tasks or remove them).
  - Notes: create (Today's card creates the day's page), edit, archive, delete, change areas.
  - Focus: sessions (`focus.record`), and parked thoughts (a note create with `source:"focus"` and `taskId`).
  - Find tasks: Add (`tasks/add`) and Not now (`tasks/dismiss_suggestion`).
  - Clear done (`tasks/clear_done`).
- **Offline, the Sage way, with no counts:**
  - a quiet capsule ("Offline. Changes will sync."), never "3 changes";
  - "Saved on this phone" on a note while it waits;
  - a small cloud mark on anything not yet sent.
  - Acknowledgements ("Moved to Tomorrow") keep coming from the capsule that already exists.
- **Conflicts** follow the main app's rules: the last write wins on the server, but the phone never replaces what you're looking at while you have unsent changes to it.
- **Check:**
  - in airplane mode, add, tick, move and write, then reconnect: everything arrives once, in order, with the times it was made;
  - kill the app while offline: nothing is lost;
  - a create that the server returns under another area id is remapped.
- **Then switch to your own account,** once these checks pass.

### Phase 5: the editor (L)
- **What comes over:** `NoteEditor` (Tiptap in a DOM component), the `BootedNoteEditor` wrapper (the first props stay empty until the page is up, to work around the WebView escaping problem), `localDrafts`, `noteDocs` and the note screen's save rules:
  - save 900 ms after typing stops, and on leave, background or tab switch;
  - flush the editor on leave;
  - the draft wins over the server's copy if it's newer;
  - the server's copy only replaces the page when you haven't typed.
- **Rich text is live** (since 3 October), so notes keep their formatting from the start.
- **Sage styling** through the editor's props and CSS:
  - Nunito Sans through `expo-asset`;
  - Sage's page and ink colours;
  - the accent for the caret and links;
  - quotes drawn as Sage's accent questions;
  - checklist boxes drawn like `CircleCheck`.
- **Sage's note page stays:**
  - the area chip, opening a sheet that picks several areas;
  - the small-capital date line and the title field;
  - the tools row mapped to `run(...)`: text styles, checklist, list, link, indent and outdent (the image tool waits for photos in the main app's plan);
  - Tasks and Done.
- **Writing to questions:**
  - Today's card opens the day's page with its question as the first quote. "Next question" inserts another as a quote (`run("insertQuestion")`).
  - The questions come from `suggestions/generate`, with Sage's built-in ones when offline or with AI off.
  - "Go deeper" at the end of a note uses the same questions.
  - Word suggestions (completions and sentence starters) come in Phase 6, or later.
- **Edit times:** with `changedAt`, a server copy can carry an earlier time than before. The draft-or-server choice (`applyNote`) must still prefer a draft written after it.
- **Tidying:** turn off the editor's `TRACE` logging and keep perf logging to development.
- **Check:**
  - the main app's editor tests (`tests/note-editor`, about 75 checks) run against revamp 5's dev server;
  - on the phone: typing, the keyboard, the cursor kept in view, lists and checklists, Backspace at an item's start, links;
  - leave mid-sentence, kill the app, come back offline: the words are there.

### Phase 6: AI help and focus (M)
- **Find tasks:**
  - a note's undecided suggestions come with its tasks (`pending`), so they're there when you come back, without asking the AI again;
  - `tasks/extract` waits for the note to sync first, then shows new results as Sage's cards (Add becomes a check, Not now dismisses);
  - it runs automatically the first time a note's tasks open, as the main app does.
- **How it's going:** `tasks/summary`, cached, read while offline, shown with Sage's dots and word-by-word reveal.
- **Focus:**
  - first steps from `tasks/first_steps`;
  - sessions recorded with `focus/record`;
  - end alerts as local notifications;
  - the chime and keep-awake as in the main app.
- **Title ideas** (`notes/suggest_title`) are applied quietly when you leave a note with no title. **Indexing** (`notes/reindex`) runs after edits. Accepted suggestions are logged (`suggestions/event`).
- **AI errors stay calm:** out of credits, or too many requests, gives a quiet message. Offline, the AI buttons step back rather than fail.
- **Check:** each AI action works, and degrades gracefully offline and when the AI is busy. Suggestions left undecided are still there after leaving and reopening a note.

### Phase 7: reminders (S–M)
- **What comes over:** the reminders code as is:
  - local notifications, at most 50 waiting, repeating tasks scheduled up to six times ahead;
  - Done and Snooze buttons on each reminder;
  - a tap opens the task.
- **When it asks permission:** the first time a reminder is set, or focus starts.
- Sage's reminder sheet already speaks the same model (`remindBefore`, `remindRepeat`).
- **Check:** a reminder fires on the phone in Expo Go; Done from the notification ticks the task; Snooze moves it an hour.

### Phase 8: hardening (M)
- **Checks:**
  - the web-based interaction checks (`interact.js`), run against the test account as well as Demo mode;
  - the scan for counts;
  - light and dark screenshots.
- **On the phone:** slow network, airplane mode, sign out with unsynced changes, two devices, large text, Reduce Motion.
- **Performance:** check on a release build before anything ships. Expo Go hides jank.
- **Decide the end state** (section 8).

**Order and size:** phases 0 to 4 go in order; 5, 6 and 7 can follow in any order once 4 is in. Roughly two weeks of focused work in total, with the editor and the offline layer the largest pieces.

---

## 5. The API changes

All four live on revamp 5's branch and share one migration, `migrations/014_task_times_pages_suggestions.sql`. The third and fourth also settle two open write-ups in `docs/investigations.md`.

### 5.1 When a task was done, and the day it moved from
- **Migration:**
  - add `tasks.completed_at` (timestamptz) and `tasks.moved_from` (timestamptz, at local noon like `complete_by`);
  - fill `completed_at` from `updated_at` for tasks already done (the best guess there is).
- **`tasks/update`:**
  - a status of done sets `completed_at` (to `changedAt` when given, else now), only if the task wasn't done already, so a replayed change doesn't move it; any other status clears it;
  - accepts `movedFrom` (a date, or null). The phone sends it when Catch up, the menu or the date sheet moves a task, keeping the first day it was planned for, as Sage's store does.
- **`tasks/list`:** each task now includes `completedAt` and `movedFrom`.
- **Repeating tasks:** ticking one rolls it forward rather than finishing it (as in the main app), so it doesn't appear under Done. Listing it there would need a "last done" time. Left out for now.
- **The main app** ignores both fields; its own moved-from list on the phone keeps working.

### 5.2 Today's page
- **Migration:** `notes.source` may also be `'page'` (its check constraint is widened).
- **Server:** `NoteSource` gains `"page"`. `notes/create` accepts it without further change, because its schema is built from the list of allowed values.
- **Sage:** the day's page is the first note with `source: "page"` written that day. Today's card creates it; "Next question" adds to the same note.
- **The main app** only looks for `"focus"`, so it shows a page as an ordinary note.

### 5.3 Real times for edits made offline
- **No migration.**
- **Server:** `notes/update` and `tasks/update` accept an optional `changedAt` and set `updatedAt` to it, never later than now (`notInFuture` in `helpers/clientIds.tsx`). Clients that leave it out keep today's behaviour.
- **Phone:** stamps each queued update; see Phase 4, and Phase 5 for the editor's draft check.
- From the write-up "Changes made offline are stamped with the time they sync, not when they were made".

### 5.4 Find tasks suggestions kept until you decide
- **Migration:** a new `task_suggestions` table:
  - columns `id`, `user_id`, `note_id`, `fingerprint`, `text`, `project_name`, `complete_by`, `status` (`pending` or `dismissed`) and `created_at`;
  - unique on `(note_id, fingerprint)`, and removed with its note.
- **`tasks/extract`:**
  - replaces the note's pending suggestions with the new result, skipping dismissed ones and ones already added;
  - on an unchanged note it returns the pending ones instead of nothing. Both apps already show whatever comes back, so this also fixes the main app's vanishing suggestions without touching its code.
- **`tasks/list?noteId=`:** adds `pending`, so a note's tasks open with its undecided suggestions and no AI call.
- **`tasks/add`:** removes the pending rows it turns into tasks.
- **New `tasks/dismiss_suggestion`:** marks one dismissed; Sage's "Not now".
- From the write-up "Suggested tasks disappear if you leave a note without deciding".

### Shipping them
1. Write the changes on revamp 5's branch; `npm run typecheck` passes.
2. **Apply migration 014, with your OK.** It only adds, so the live server simply doesn't see the new parts. It goes on before any code that reads it.
3. Run the new server on this machine (`npx tsx server.ts` with Railway's variables, through `railway run`) and exercise every change against the test account.
4. **Deploy from revamp 5's branch, with your OK.**
   - First list what would ship (`git diff --stat` against the last deploy).
   - The deploy also ships the 4 October change to the notes lists (they leave the rich text out), which the main app's current code expects.
   - Afterwards `/` gives 200 and `/_api/notes/list` gives 401 when signed out.
5. Check the main app on your phone.

**From then on, deploy from revamp 5's branch.** The main app's branch doesn't have these changes, and a deploy from it would remove them. Merge revamp 5's server changes into it first.

---

## 6. Risks and how they're handled

| Risk | Handling |
|---|---|
| **One database, holding your notes.** The app is in development, but revamp 5 and the main app share the database | Build with a **test account** (every query is scoped to the signed-in user). Migrations only add, and each one waits for your OK. Seeding only ever fills the test account. Your account comes once the offline phase's checks pass |
| **A deploy ships a whole folder**, so deploying from the wrong place removes work | Deploy only from revamp 5's branch, which carries the live server code. List what would ship and ask before each deploy. Merge into the main app's branch before anyone deploys from it |
| **The two apps drift apart.** The main app keeps changing | Copy from 44abd69, record sources in `SOURCE.md`, and bring later fixes across deliberately |
| **superjson and Clerk details** | Use the main app's client and `AuthProvider` unchanged; Phase 1's checks cover token refresh and offline start |
| **No incremental sync** (whole lists; notes capped at 200 unpaged) | Today asks for the visible week's notes, the Notes tab pages, and Search asks the server |
| **Sage's appearance settings stay on the phone** (colour, paper, appearance, larger text) | As the main app does with its theme. They could join `preferences` later if they should follow you to a new phone |
| **Google sign-in in Expo Go** comes back through an `exp://` address, and the quick tunnel's address changes on every restart | Email sign-in works regardless. Test Google once on a stable address (a named tunnel), allowed in Clerk if it asks |
| **Memory on this machine** (Metro, tests and other servers share 5.4 GB) | Same habits as now: one Metro, fresh browser tabs per check, web exports for screenshots. The local server runs only while the API changes are tested |

---

## 7. Decisions (2026-10-05)

| Question | Decision |
|---|---|
| Which backend | The existing one: still in development, so no separate staging setup |
| Which account | A test account first; yours once the offline phase's checks pass |
| Where the code goes | Copied into revamp 5's `src/core/`, as asked |
| The rich-text work that sat unsaved | Committed where it was, as checkpoint 44abd69 on `dev-build-editor-lab`, then merged into `revamp-5` (32e8adf). Neither is pushed |
| Rich text | Live since 3 October, so there's no Markdown-only stage |
| API changes | All four in section 5 |
| Areas on notes | Several: cards show the first, and the area sheet picks several |

## 8. After this: the end state

When revamp 5 works against real data, choose how it reaches the App Store:
- **(a)** it becomes the app: same EAS project, bundle ids and Clerk instance, replacing `mobile/`;
- **(b)** its screens and tokens move into `mobile/`, following DESIGN.md's porting order.

Phase 8's findings should settle it. Either way the backend needs nothing beyond section 5.
