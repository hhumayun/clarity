# Handoff: where revamp 5 stands, and what's next (2026-10-06)

First written as a session ended on 2026-10-06 (the dev machine was getting more memory), and brought up to date after phase 6 the same day. Read this first. Then read `docs/backend-plan.md` (phases, decisions in section 9) and `docs/editor-plan.md`.

## Where everything is

- **Running copy:** `/root/projects/clarity-revamp-5`. Metro serves from here, and it has `node_modules`.
- **Git:** branch `revamp-5` of github.com/hhumayun/clarity (public). Its worktree is `/root/projects/clarity-revamp-5-branch`, and the app sits under `prototypes/revamp-5/`.
  - To commit: `rsync -a --delete --exclude node_modules --exclude .metro-cache --exclude dist --exclude .expo --exclude .gitignore --exclude README.md --exclude '.env*' /root/projects/clarity-revamp-5/ /root/projects/clarity-revamp-5-branch/prototypes/revamp-5/`. That skips every README.md, so copy `tests/*/README.md` across by hand. Then commit in the worktree.
  - Never switch branches in `/root/projects/clarity`: the user's Clarity Dev build runs from `dev-build-editor-lab` there.
- **Server:** the same branch (root `endpoints/`, `helpers/`, `migrations/`).
  - Production is deployment **5474299f** (2026-10-06 12:06 UTC), revamp-5 at 23a5d22: 130b109e's server plus suggestion events kept only with Learn from my writing on.
  - Migrations **001–016** are applied to production.
- **Never commit:** design research (Appllama, Mobbin and Rosebud images in `/root/projects/clarity-design-research`), `.env*` files (keep them outside project folders), or backups (`/root/.config/clarity-backups`).

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
- **Unit tests:** `for t in src/store/boundary.test.ts src/data/outbox.test.ts src/editor/noteCopies.test.ts src/editor/wordFit.test.ts src/data/reminders.test.ts src/lib/parseTask.test.ts; do /opt/node24/bin/node --import ./scripts/ts-resolve.mjs $t; done`
- **The editor page:** `npm run editor` after changing `editor/`, then `tests/editor/editor.test.js` (see its README).
- **Checks:** `tests/checks/README.md` (setup, the test account, which scripts touch the live server).
- **Deploying the server (only with the user's OK):**
  1. `git -C /root/projects/clarity-revamp-5-branch archive HEAD | tar -x -C /root/projects/clarity-deploy`.
  2. `cd /root/projects/clarity-deploy && pwd`, in its own call.
  3. `railway up /root/projects/clarity-deploy --ci --project bd49cfaa-74d4-4888-ba84-36185f6bd626 --environment production --service clarity-notes`, alone, with no `cd`, `timeout` or pipe ("prefix not found" otherwise).
  4. Check: `/` gives 200 and `/_api/notes/list` gives 401 unsigned.
  5. Delete the export.

  Migrations are applied by hand through `railway run`, **before** deploying code that reads new columns, and also only with the user's OK.
