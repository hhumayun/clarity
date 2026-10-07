# Handoff: where revamp 5 stands, and what's next (2026-10-06)

First written as a session ended on 2026-10-06 (the dev machine was getting more memory), and brought up to date after phase 6 the same day. Read this first. Then read `docs/backend-plan.md` (phases, decisions in section 9) and `docs/editor-plan.md`.

## Where everything is

- **Running copy:** `/root/projects/clarity-revamp-5`. Metro serves from here, and it has `node_modules`.
- **Git:** branch `revamp-5` of github.com/hhumayun/clarity (public). Its worktree is `/root/projects/clarity-revamp-5-branch`, and the app sits under `prototypes/revamp-5/`.
  - To commit: `rsync -a --delete --exclude node_modules --exclude .metro-cache --exclude dist --exclude .expo --exclude .gitignore --exclude README.md --exclude '.env*' /root/projects/clarity-revamp-5/ /root/projects/clarity-revamp-5-branch/prototypes/revamp-5/`. That skips every README.md, so copy `tests/*/README.md` across by hand. Then commit in the worktree.
  - Never switch branches in `/root/projects/clarity`: the user's Clarity Dev build runs from `dev-build-editor-lab` there.
- **Server:** the same branch (root `endpoints/`, `helpers/`, `migrations/`).
  - Production is deployment **4f947109** (2026-10-07 05:19 UTC), from branch `revamp-5-ux` at 3b2752a: 5474299f's server (revamp-5 at 23a5d22) plus suggestions' "words" and "questions" modes and their `Server-Timing` header (695c3bc). Nothing else on the server changed.
  - The server now moves on `revamp-5-ux`: export that branch to deploy (step 1 of the procedure below), not revamp-5.
  - Migrations **001–016** are applied to production.
  - **Dev** (from 2026-10-07) is a separate server and database for trying changes first. See "Dev" below.
- **Never commit:** design research (Appllama, Mobbin and Rosebud images in `/root/projects/clarity-design-research`), `.env*` files (keep them outside project folders), or backups (`/root/.config/clarity-backups`).

## Dev: its own server and database (from 2026-10-07)

Set up from a cloud session (Claude Code on the web) on branch `revamp-5-cloud-exp`, so work there never touches production or the data in it. Try server changes and migrations on Dev first.

- **Server:** Railway project clarity-notes, environment **Dev** (`0a2f2bc8-9117-4058-8a10-0200bed44f7c`), service clarity-notes, at https://clarity-notes-dev.up.railway.app.
  - It deploys by itself on every push to `revamp-5-cloud-exp` (a GitHub source set on Dev only). First good deployment: 9a6bb36f, at 6922de9.
  - Production is unchanged: no GitHub source, deployed only by hand (the procedure under "Running it"). Code reaches production only once it is on `revamp-5-ux`. On 2026-10-07, `revamp-5-cloud-exp` was `revamp-5-ux` (c182c1d) plus 6922de9.
  - Check it as production is checked: `/` gives 200 and `/_api/notes/list` gives 401 unsigned.
- **Database:** Neon project Myproj (`still-dream-66134277`), branch **dev** (`br-restless-cake-aei2ueyj`). A full copy of production made 2026-10-07 at 14:01 UTC (the user's choice: production holds only their own notes), so the test account and the user's account are there as they were then.
  - What's written on Dev stays on Dev. Neon's "reset from parent" brings the branch back to production's current state and throws away everything written on Dev: ask first.
  - Migrations: the dev branch first (Neon's SQL editor or connector, or `railway run --environment Dev`), check, then production with the user's OK as before.
- **Dev's variables** were copied from production when the environment was made: the same Clerk instance, and the same OpenRouter and Gemini keys, so AI use on Dev counts against them. Two differ:
  - `DATABASE_URL`: the dev branch's pooled connection string, without Neon's `channel_binding=require` (postgres.js would pass it to Postgres as a setting).
  - `CORS_ORIGINS=http://localhost:8081`, for a web build served by Metro on port 8081.
- **Builder:** `railway.json` says Railpack since 6922de9. It said Nixpacks, which `railway up` builds never used. A GitHub deploy follows the file, so Dev's first build ran Nixpacks on Node 18, `npm ci` left out devDependencies under `NODE_ENV=production`, and it stopped at "vite: not found".

### Using Dev from a cloud session

- **Point the app at Dev:** `EXPO_PUBLIC_API_BASE_URL=https://clarity-notes-dev.up.railway.app` and `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=<the pk_test_ key>`. Set them in the cloud environment's variables rather than a `.env` in the project. Serve the web build on 8081, the port Dev allows: `CI=1 npx expo start --web --port 8081`.
- **Network:** the environment's Allowed domains need `*.clerk.accounts.dev` and the Dev domain (or `*.up.railway.app`).
  - Neon's Postgres port (5432) can't be reached from the container: use the Neon connector for SQL.
  - Node's own `fetch` ignores the proxy: run Node scripts that call the server with `NODE_USE_ENV_PROXY=1`.
- **Signing in:** the test account (`tests/checks/README.md`), code 424242. Google sign-in can't be done in a headless browser. `mobile/` signs in only with a password or Google, so it can't use the test account.
- **Installing:** `npm ci` stops with EOVERRIDE. The tiptap packages are devDependencies at `^3.27.1` and overrides at `3.27.1`, which npm 10 and 11 refuse. Until `package.json` is fixed, write each such override as `"$<its name>"` for the install, then put `package.json` back.
- **The checks still talk to production:** `LIVE` and `APP` (port 8087) are fixed in the scripts. Only `api-check.mjs` (`API=<url>`), `words-account.mjs` and `suggest-timing.mjs` (`SERVER=<url>`) can be pointed at Dev.

## UX improvements: branch `revamp-5-ux` (from 2026-10-06)

- **The plan:** `/root/projects/uximprove/plan.md` (not in git). Seven phases from the UX audit in the same folder.
- **The user's choices:** filter motion A (fade-through, 8 pt rise); Notes and Search the same as Life; the five product calls agreed; foundations first; a commit at each phase.
- **Where:** branch `revamp-5-ux`, made from revamp-5 at 830895a, worktree `/root/projects/clarity-revamp-5-ux`. revamp-5 itself stays at 830895a.
  - To commit, rsync the running copy into `/root/projects/clarity-revamp-5-ux/prototypes/revamp-5/` (same flags as below), copy `tests/*/README.md` by hand, and commit there.
  - The running copy now holds the UX branch's app. To try revamp-5 as it was, rsync that worktree's `prototypes/revamp-5` back into the running copy.
- **Phase 1, foundations and bugs, is done:**
  - **Reduce Motion:** `keep` and `fadeTiming` in motion.ts. Fades, presses and functional timings play; travel snaps.
    - The plan said `ReducedMotionConfig` Never, but that switch overrides every animation, so anything missed would move under Reduce Motion. This way is safer, with the same outcome.
  - **Shared presets** (`arrive`, `arriveSlow`, `leave`, `settle`, `riseIn`, `arriveAfter`) and press depths `squash` / `squashSmall`.
  - **One weight when choosing or ticking.**
  - **The capsule** in a FullWindowOverlay on iOS: not modal for VoiceOver, mounted only while it shows, rolls its words, announced.
  - **Bugs:**
    - Hold to stop under Reduce Motion;
    - deleting a task showing "could not be found";
    - Today after midnight (`src/data/dayRollover.ts`);
    - the Today tab resetting a viewed day;
    - `(tabs)` sliding in like a push;
    - Go deeper forgetting Not now;
    - "Saved to Notes" staying;
    - filters on a renamed or removed area;
    - the areas sheet failing silently on a duplicate name (and its 36 pt shift when renaming);
    - Learn from my writing not optimistic;
    - accounts' new-task glow;
    - the skeleton's label and Today's "All done";
    - Search's 12-result cap ("Show more", no count);
    - a failed font leaving the splash up.
  - **Checks:** `tests/checks/phase1-check.mjs` (18). Run against 830895a, it catches six of these bugs. The delete flash only shows during the phone's slide.
- **Fixed before phase 2: Life and Notes sometimes opening blank** (the user saw it on the phone).
  - **Cause:** expo-router 57's copy of the tab view derives each page's attachment from the navigator's fade on the native driver, so a switch can leave the chosen page detached (expo/expo#49681). React Navigation fixed this in bottom-tabs 7.18.8 (July 2026); expo-router hadn't by 57.0.24.
  - **Fix:** the navigator no longer animates (`animation: "none"` in `app/(tabs)/_layout.tsx`). TabBar's veil, in the page colour, covers on a tap and lifts once the new page is drawn, so the new page still fades in.
  - **The browser can't show the bug** (it runs those animations in JavaScript and doesn't detach pages). `tests/checks/tab-open.mjs` (150 taps) guards the switching, and `tab-feel.mjs` now measures the veil.
  - Bring the navigator's fade back only once expo-router has the fix.
- **Phase 2, swaps, is done:**
  - `src/ui/filterSwap.ts` (`useFilterSwap`, replacing `useQuietFilter`): the list dips, swaps out of sight and rises; the latest choice wins; `quiet` holds the rows' own animations; `ready` lets first content rise in.
    - The fade goes on an `Animated.View` around the list. On `Animated.FlatList` itself it didn't apply on web.
  - `src/ui/ChipRow.tsx` with `useStretchTo` (stretch.ts): one measured ink ring that travels, plus scrolling a chosen chip into view. Used on Life, Notes and Search.
    - Search's chips moved under its field, and Search swaps results after a 120 ms pause in typing.
  - Notes' filter row moves the list down (a `layout={settle}` wrapper).
  - Today: the old day leaves (`FadeOutLeft`/`Right`), the title and the pill fade, the week strip's swipe leaves before the new week comes in, and Today's card cross-fades at a new time of day.
  - Placeholders and LoadProblem fade.
  - Go deeper's dots and question fade into each other.
  - The note's tasks sheet opens already reading, and what follows the found cards moves with them.
  - **Checks:** `tests/checks/filter-swap.mjs` (22). The chip's label inks in about 0.16–0.3 s on Life at 4× CPU in the web build, and 0.5–0.7 s on Notes' first tap there (the ring moves on the UI thread at once on the phone).
- **Phase 3, writing, is done in the browser and waits for the user's phone look:**
  - **The keyboard** (`app/note/[id].tsx`; `GentleKeyboardAvoidingView` is gone):
    - Go deeper, Tasks and Done sit in a block at the bottom that's always mounted. It fades as the keyboard covers it (`1 − progress` from `useReanimatedKeyboardAnimation`), and fades back as the keyboard goes.
    - The tools ride on the keyboard (translateY = its height, as `KeyboardStickyView` does) and fade in with it. They hide only once the keyboard has gone (onEnd), or at once when the title takes the keyboard.
    - The words end above whichever is higher: the block (measured, and followed with `settle` when it changes size) or the keyboard plus the tools.
    - Interactivity switches when the keyboard starts to move (`useKeyboardHandler` onStart), not when it's done. Hidden parts are `aria-hidden`.
    - In the web build, writing in the words stands in for the keyboard.
  - **Nothing jumps:**
    - Today's question keeps its tools' row for the visit, and only the icons fade.
    - Word help's strip lies over the bottom of the words. While writing with AI help on, the editor keeps the room for it (`inset`: bottom padding, and the caret kept above it, ProseMirror's own scrolling included).
  - **A new page opens to write:** its buttons wait under the keyboard until it first goes down (1.2 s if it never comes). It gets Go deeper once written (not on question pages, which have Next question).
  - **In the editor page:** ticking a checklist row pops its check (Web Animations; ProseMirror redraws the row) and tells the app (`ticked`, which plays the haptic). The strike fades in. A new question rises into place and the page glides to it. A newer copy cross-fades in.
  - **Opening:** the editor mounts at once and waits for the note (`NO_SEED_YET`). Its start limit counts from when the note is there. The placeholder lines breathe.
    - The browser shows no difference (about 0.55 s either way). The development build logs `[note] … shown N ms after opening` to Metro's log (`/tmp/clarity-revamp-5/expo.log`), to decide on an editor prepared ahead.
  - **Small things:**
    - The ⋯ menu floats (raised, the one shadow), fades out, closes on a tap outside, and comes last in the tree.
    - ⋯ fades in when a new note is first saved.
    - A new page shows its time from the first frame, and the last page's area never shows (a layout effect).
    - The list's note card fades in a title that changes (the AI's) and its "not sent" cloud.
    - The keyboard-away tool ticks.
    - Search puts its keyboard away when a note opens, so the note isn't left behind the keyboard without its buttons.
  - **Checks:** `tests/checks/phase3-check.mjs` (23) and eight new editor-page tests (93 in `tests/editor` now). All the other checks pass, the account ones included.
- **The user liked phase 3 on the phone (2026-10-07).** Then asked for word help to be flawless. They saw:
  1. topic suggestions (the ways to start the next sentence) never appearing;
  2. completions slow, and appearing at random or not at all;
  3. the strip changing with every key typed;
  4. the strip going as soon as a word was picked.
- **Why** (measured with `tests/checks/suggest-timing.mjs`):
  - The app asked only after 2.5 s of stillness, 30 new characters and 20 s since the last ask.
  - It dropped an answer if anything was typed while it came, and hid the strip on any key or pick.
  - The live server took 2–4.6 s per answer (up to 7 s). The model's part of that is 1.1–1.4 s, for a big answer: five completions, six stems and four questions.
  - Starts were the strip's last two chips, off the edge of the screen mid-sentence.
- **Built (app):**
  - `src/editor/wordOffer.ts` (`fitsNow`, `insertionFor`, `wantsNew`, `typedSince`) decides what of an offer still fits as the writer types on. Tested by `src/editor/wordOffer.test.ts`.
  - `useWritingHelp` was rewritten around it: asks after 0.8 s of stillness when what's shown no longer fits and 6 new characters are written, at most every 3 s, at once after a pick. Answers that come mid-flow wait for a 450 ms rest. A pick holds the strip with dots (`loading`) until new words come.
  - The editor page does the final fitting (`insertWords`, answered by `inserted`). The app's cursor can be 120 ms behind, so a word begun just before the tap was put in twice before.
  - `WordStrip`: two rows in a fixed room above the tools (finishes over starts), chips fading in and out and closing up with `settle`.
  - Go deeper asks for questions only.
  - Found on the way: a newer copy of a note fading in could overwrite words typed during its 110 ms dim. Now those words win.
- **Built (server, deployed with the user's OK on 2026-10-07 as 4f947109):** `suggestions/generate` takes an optional `mode`:
  - `"words"`: three completions and one stem per mood, about half the model's time. It waits at most 0.4 s for the writer's context, and stalls are given up after 5 s with no retry.
  - `"questions"`: questions only.
  - Omitted, it answers as before, so the main app is unchanged.
  - A `Server-Timing` header gives `context` and `model` times.
  - Run locally with production's environment (`railway run … tsx server.ts` on port 3399, suggestion calls only), words take 0.5–0.7 s against 1.1 s for everything.
  - The app works with either server: an older one ignores `mode` and answers everything.
- **Checks:** `tests/checks/words-account.mjs` (14; `SERVER=` points the suggestion asks at another server). It passes against both the live server and the local one. `words-flow` and `ai-account` were brought up to the new timing. `phase1-check` and `interact` no longer assume today isn't Wednesday. There are seven more editor-page tests (100).
- **Live, measured from this machine (network to Railway included):**
  - Words: 0.75–1.2 s, where the full answer the app used to ask for takes 1.3–2.5 s.
  - In the timing header: about 0.22 s reading the writer's context, then 0.3–0.8 s of model time for words, against 0.85–2.1 s for everything.
  - In the web build the strip shows about 2 s after typing stops.
  - The model sometimes offers completions after a full stop; the app drops them.
- **A possible next step (not built):** cache the writer's context on the server for a minute per note. That would save about 0.22 s per ask.
- **Next:** the user's phone look at word help (the 0.8 s pause is a first guess), then phase 4.

## What's done

- **Phases 0–4** (accounts, API changes, your data, offline) are done. Saving is open to every account.
- **Phase 5, the editor, is built** (1a8fa6d).
  - The main app's Tiptap editor, with its page built into the app (`editor/`, `npm run editor` → `src/editor/page.ts`), in a plain web view, so it opens offline in Expo Go.
  - Every tool the main app has; questions as quotes.
  - Checks: `tests/editor` (82) and `tests/checks`.
- **The user's feedback** (2fed946):
  - no sync text on the note page;
  - the server hears at most once a minute while writing, and on leave or background;
  - repeats and reminders are separate, with "Just this time" (`remindOnce`, migration 016);
  - Tasks and Done stay down while the keyboard is up.
- **Server, deployed with the user's OK** (130b109e):
  - AI only through zero-retention endpoints (`provider.zdr: true`);
  - rich text stored encoded once, with old copies read back (migration 015 unwrapped the 11 stored ones);
  - `remind_once`.
- **Server, deployed with the user's OK** (5474299f, 23a5d22): with Learn from my writing off, `suggestions/event` keeps nothing and answers `{ recorded: false }`. Checked live: `tests/checks/event-check.mjs`, then `event-rows.mjs` (read-only) found no row; `ai-account.mjs` 40/40 sees words kept with it on; `api-check.mjs` 16/16.
- **Tab-switch speed, partly done** (committed with this note):
  - **Notes** is a virtualised list (`Animated.FlatList`, only the cards on screen) with no per-card animations. With 88 notes, the first open went from 10.1 s to about 1.1 s at normal speed in the web build.
  - **The check circle** (`CircleCheck`) draws a still version until a finger is on it or it changes. Lists draw dozens.
  - **Task rows** watch only their own note's title, not the whole notes list, and `TaskRow` is memoised.
  - **Tried and reverted:** `freezeOnBlur` on the tabs. Coming back to a frozen tab redraws all of it, and returning got much slower.

- **Phase 6, AI help, is built** (f927c7a and the commit after it). See "Phase 6" below for what's in and what's left.

- **From the user's phone test (2026-10-06):**
  - **A jolt as a note opened:** for an account's note, the title filled in a moment after the page arrived (two phone-storage reads), the words rose 8 points as they faded in, and Go deeper popped in under them. Now the title comes from the list's copy at once, the words only fade, and Go deeper is there from the start. The editor page also sets up its fonts once, and says it's shown only once they're loaded and the words are drawn. Check: `tests/checks/note-open.mjs`.
  - **Area filters:** the chips tick (Notes and Life; Search already did). Life's lag was every leaving row's fade-out and every staying row's slide (Reanimated exit and layout animations, and the measuring they force), so filtering now goes in steps a frame apart (`src/ui/quietFilter.ts`): the chip, then the rows drop their animations, then the list changes. Life also keeps two screens drawn either side, not four. In the web build at 4× slower CPU with 80 tasks, the chip went from 1.2–2.6 s to 0.15–0.3 s from the press, and the rows on screen from 1.2–2.6 s (then a third of a second of sliding) to 0.95–1.3 s, settled. `tests/checks/filter-lag.mjs`.

## Waiting on the user

- **A phone test of everything above:** the editor, the feedback changes, the tab changes, and now AI help. They haven't tried any of it on the phone yet.
  - Their phone has been through the opening screens, so Sage asks about AI help once ("Gentle help") the next time it opens.
- **Check Metro and the tunnel are running** (see "Running it"). A new tunnel gives a **new** Expo link.

## Next, in order

### 1. Tab switching: done (2026-10-06), waiting on the phone test

- **Life** is drawn as it scrolls: each task is a slice of its section's card (`TaskSlice`), with a clipped, taller card under each slice so the shadow runs on with no seam.
  - At phone speed (Chrome 4×) with 80 tasks, Life took 4.6 s to appear; now about 2 s, whatever the number of tasks.
  - The earlier "minutes" were this machine running out of memory.
- **A 200 ms fade-through** between places (`app/(tabs)/_layout.tsx`), instant with Reduce Motion.
- **Preloading:** once the app is idle, Notes, Life and Search are drawn ahead, one at a time, with `router.prefetch`. Switches now take about 0.35–0.43 s in the web build, fade included (`tests/checks/tab-feel.mjs`).
- `tests/checks/interact.js` now expects the editor's note page and no "Saved" after Done (27/27).
- Still worth doing: judge the feel with `npx expo start --no-dev --minify` on the phone; dev mode is several times slower.

The notes below are from before this work, kept for the record:

- **Life is slow with many tasks, and grows faster than the number of tasks.**
  - Life with 20 demo tasks drew in about 0.6 s; with 80 it didn't finish in minutes in the web build. The machine was short on memory, so treat the absolute numbers with care, but the growth is real.
  - Get the curve with `tests/checks/life-growth.mjs` (COPIES=1,2,3).
  - Suspects:
    - every task row in `TaskCard` is an `Animated.View` with `layout`, `entering` and `exiting`; Reanimated measures each of them, and on web forces a layout per row;
    - a `SwipeRow` gesture handler per row;
    - each row's `wash` and `Strike` animated styles.
  - Likely fix: draw Life as one virtualised list. Section headings and task rows would each be a card "segment": the first and last rows take the rounded corners, with hairlines between. Or at least drop per-row `layout` until after the first draw.
- **Then soften the switch, as researched:** a 200 ms fade-through on the content only, with no slide and nothing re-animating on revisits. Instant with Reduce Motion (`useReducedMotion`). In `app/(tabs)/_layout.tsx`:

  ```tsx
  import { Easing } from "react-native"; // the vendored tabs use RN's Animated
  const fadeThrough = {
    animation: "fade" as const, // must not be "none", or the spec below is ignored
    transitionSpec: { animation: "timing" as const, config: { duration: 200, easing: Easing.out(Easing.quad) } },
    sceneStyleInterpolator: ({ current }: any) => ({
      sceneStyle: {
        opacity: current.progress.interpolate({ inputRange: [-1, -0.5, 0, 0.5, 1], outputRange: [0, 0, 1, 0, 0] }),
        transform: [{ scale: current.progress.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.985, 1, 0.985] }) }],
      },
    }),
  };
  ```

- **Preload Notes, Life and Search once idle**, so even a first visit is instant: `requestIdleCallback(() => ["/notes", "/life", "/search"].forEach((h) => router.prefetch(h)))`. `InteractionManager` does nothing in RN 0.86.
- **Judge the feel on the phone in a production-like bundle:** `npx expo start --no-dev --minify` works in Expo Go. Development mode is several times slower, and the user's "laggy" was felt in it. Phase 8's release build is the real test.
- **Research behind this:**
  - **Apple's tabs:** since iOS 18, UIKit's tab controller cross-fades with a slight zoom between tabs. The HIG has no animation guidance for tab bars, but says to avoid motion on frequent interactions.
  - **Material:** "fade through", with the incoming screen from 92% scale, over 300–450 ms.
  - **Other apps:** no library has recordings of top apps' tab switches, so what they do is unverified.
  - **Expo Router's tabs:** the JS tabs offer `animation: "fade" | "shift" | "none"`, `transitionSpec`, `sceneStyleInterpolator`, `lazy` (default true) and `freezeOnBlur`.
  - **Native tabs** (`expo-router/unstable-native-tabs`, stable in SDK 58): they can't hold the centre "+", so stay on the JS tabs.
  - Contact sheets are in `clarity-design-research/revamp-5/tabs/` (don't commit them).

### 2. Phase 6: AI (decided and built on 2026-10-06)

**Built** (checks: `tests/checks/ai-account.mjs` 40, `firstrun-ai.mjs` 11, `words-flow.mjs` 14, `src/editor/wordFit.test.ts` 19):
- **The choice:** `ai` in `src/state/device.ts` (null = not asked); `src/data/ai.ts` (`useAiOn`, `useAiReady`, `aiOn()`, the wording); the opening screens' "help" page; `app/ai-choice.tsx`, asked once behind a `Stack.Protected` guard in `app/_layout.tsx`; the Settings switch, with Learn from my writing only while it's on.
- **Find tasks** for accounts in `src/data/AccountSource.tsx` (`tasks/extract`, `tasks/add`, `tasks/dismiss_suggestion`), the first time a note's tasks open, with AI help on.
- **How it's going** (`tasks/summary`) on the task page and **first steps** (`tasks/first_steps`) in Focus, with Sage's own as the fallback.
- **Titles and indexing** once on leaving a changed note (`afterLeaving` in `src/editor/useNoteSession.ts`), after its words reach the server.
- **Word help and the AI's questions** (`src/editor/useWritingHelp.ts`, `wordFit.ts`, `src/ui/WordStrip.tsx`): one `suggestions/generate` ask per pause gives the strip and the questions; Go deeper asks about a whole note only when another question is wanted. The editor page keeps the cursor in sight when its room changes.
- The thresholds (`ASK_AFTER_PAUSE_MS`, `ASK_AFTER_NEW_CHARS`, `ASK_GAP_MS`) are a first try: tune them with the user on the phone.

**Left:**
- The phone test: the strip's feel above the keyboard, and whether it comes too often or too seldom.
- Every check passed on 2026-10-06 after this work. The older account checks now answer the AI page with "Not now"; `account-check` and `offline-check` read a note's words from the editor's frame.

The decisions were these (`docs/backend-plan.md`, section 9):
- AI only through companies that keep nothing (done on the server);
- ask on the opening screens, with an "AI help" switch in Settings;
- word suggestions as a quiet strip above the keyboard (to experiment with);
- the AI writes Go deeper and Next question, and Today's question stays Sage's own;
- Find tasks the first time a note's tasks open; How it's going when a task opens (cached); first steps when Focus opens;
- titles given quietly on leaving an untitled note;
- Learn from my writing on by default; no per-person spending limit for now.

The plan it was built from:
1. **The choice.**
   - A device setting in `src/state/device.ts`: `ai: "on" | "off" | null`, where null means not asked yet.
   - A first-run page between "Gentle help" and "Yours alone". It says plainly that AI help sends what it reads to AI companies that don't keep it or train on it, and offers Turn on / Not now.
   - Phones that have already been through the first run are asked once at the next launch.
   - Settings gets an "AI help" switch; "Learn from my writing" only matters when it's on.
   - Rewrite "Yours alone" to match.
2. **One gate:** a `useAiHelp()` hook (on, and online), checked before every AI call. When it's off, Sage's own text stands in and nothing is sent.
3. **Find tasks.**
   - Replace the `declined(later)` stubs in `src/data/AccountSource.tsx` with the core's `tasks/extract` flow.
   - The server keeps undecided suggestions (`pending`, since 014); `tasks/dismiss_suggestion` is "Not now".
   - Map them to Sage's existing suggestion cards (`findTasks`, `addSuggestion`, `skipSuggestion` in the store shape).
4. **The AI's questions:** `src/core/hooks/useSuggestions.ts` (`suggestions/generate`) gives `reflectionQuestions`. Use them for Go deeper and Next question, with `src/data/prompts.ts` as the fallback.
5. **Word suggestions.**
   - The editor already reports the words around the cursor (`onCursor`) and takes `insertText`.
   - Port the main app's casing and spacing rules (`insertSuggestion` in `mobile/app/(app)/note/[id].tsx`).
   - Show completions and sentence starters in a Sage strip above the keyboard after a pause. Log accepted ones (`suggestions/event`).
6. **How it's going** (`tasks/summary`, cached) on the task page, in place of the local `summarise`. **First steps** (`tasks/first_steps`) in Focus, in place of `suggestSteps`.
7. **Titles and indexing.**
   - On leaving an untitled note, `notes/suggest_title`, then a quiet update.
   - `notes/reindex` once on leaving, not every few seconds (cost).
8. **Calm errors:** out of credits or too many requests says one quiet line. Offline, the AI controls step back.
9. **Checks:**
   - extend `tests/checks/remind-check.mjs`-style API checks for each endpoint as the test account;
   - a browser check that with AI off, no `/_api/suggestions|tasks/extract|summary|first_steps|suggest_title|reindex` request is made.

### 3. Later

- **Phase 7, reminders:** local notifications. The core rules already handle `remindOnce`.
- **Phase 8, hardening:** a release build to judge speed, then the end state (Sage becomes the app, or its screens move into `mobile/`).
- **Clerk Core 3:** `@clerk/clerk-expo` is deprecated.
- **The main app is left alone for now (the user's call).** Its follow-ups: `changedAt` from its outbox, saving its offline copy sooner, and the built-in editor page.

## Running it

- **Node:** system node is 22; unit tests use `/opt/node24/bin/node`.
- **The tunnel:**
  - Start: `/opt/cloudflared/cloudflared tunnel --no-autoupdate --url http://localhost:8087`. Note the `https://….trycloudflare.com` URL it prints, and save it to `/tmp/clarity-revamp-5-url.txt`.
  - The Expo link is `exp://<that host>`. For a QR code, run `node tests/checks/qr.js`.
- **Metro:**
  - Start from `/root/projects/clarity-revamp-5`: `EXPO_PACKAGER_PROXY_URL=<tunnel URL> npx expo start --port 8087 --max-workers 1 > /tmp/clarity-revamp-5/expo.log 2>&1 &`. For a production-like feel: `--no-dev --minify`.
  - After a new tunnel, restart Metro with the new URL.
- **Memory:** Metro is about 400 MB. With less memory, pause it (kill it by port) for `npx tsc --noEmit -p .`.
  - Never `pkill -f` a pattern that also matches your own shell command.
  - Headless Chrome crashes when memory is short, so the browser checks move around by taps.
- **Unit tests:** `for t in src/store/boundary.test.ts src/data/outbox.test.ts src/editor/noteCopies.test.ts src/editor/wordFit.test.ts src/editor/wordOffer.test.ts src/data/reminders.test.ts src/lib/parseTask.test.ts; do /opt/node24/bin/node --import ./scripts/ts-resolve.mjs $t; done`
- **The editor page:** `npm run editor` after changing `editor/`, then `tests/editor/editor.test.js` (see its README).
- **Checks:** `tests/checks/README.md` (setup, the test account, which scripts touch the live server).
- **Deploying the server (only with the user's OK):**
  1. `mkdir -p /root/projects/clarity-deploy && git -C /root/projects/clarity-revamp-5-ux archive HEAD | tar -x -C /root/projects/clarity-deploy` (the branch that carries the live server; it was revamp-5's worktree until 2026-10-07). First check what would ship: `git diff --stat <live commit> HEAD -- . ':(exclude)prototypes'`.
  2. `cd /root/projects/clarity-deploy && pwd`, in its own call.
  3. `railway up /root/projects/clarity-deploy --ci --project bd49cfaa-74d4-4888-ba84-36185f6bd626 --environment production --service clarity-notes`, alone, with no `cd`, `timeout` or pipe ("prefix not found" otherwise).
  4. Check: `/` gives 200 and `/_api/notes/list` gives 401 unsigned.
  5. Delete the export.

  Migrations are applied by hand through `railway run`, **before** deploying code that reads new columns, and also only with the user's OK.
