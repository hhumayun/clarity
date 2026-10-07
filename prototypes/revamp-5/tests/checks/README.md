# Sage's checks

These were run from `/tmp/clarity-revamp-5` until 2026-10-06; they live here now so a reboot can't take them.

## Setup, once per machine

```
cd tests/checks && npm install          # playwright-core 1.63.0
mkdir -p /tmp/clarity-revamp-5          # some write their output here
```

- Chrome: `/opt/google/chrome/chrome`. Each script launches it itself.
- Some scripts import `superjson` and `postgres` from `/root/projects/clarity/node_modules`, the main checkout.
- `PLAYWRIGHT_CORE=/path/to/playwright-core` overrides where Playwright comes from.
- **The test account:** `clarity-sage+clerk_test@example.com`, a Clerk test address whose code is always 424242. Scripts read it from `SAGE_TEST_EMAIL`:

  ```
  set -a && . /root/.config/clarity-sage-test.env && set +a
  ```

- Account checks write only clearly named "Sage check" items and remove them. **The test account also holds the user's own items** (area "Good boy", three "Dr Lee" tasks, one note); never delete those. If a run crashes mid-way, run `clean-test-account.mjs`.
- The live server doesn't accept requests from the web build's origin (`localhost:8087`), so the account checks pass the app's API calls through Playwright with CORS headers added.
- Database scripts need production's environment: run them through `railway run --service clarity-notes --environment production node <script>` from `/root/projects/clarity`, the linked directory. They are read-only unless named `apply-*` or `backup-*`.

## Web build checks (Metro on 8087 running, demo mode unless noted)

| Script | What it checks |
|---|---|
| `interact.js` | 27 demo checks across the screens, including a scan for counts; demo sends nothing |
| `shots.js <light\|dark> [names]` | screenshots into `clarity-design-research/revamp-5/shots` (never commit them) |
| `editor-flow.mjs` | 18 note-page checks: open, edit and reopen, the tools, Today's question, Next question |
| `words-flow.mjs` | 14 checks of word help in demo mode: no strip while typing, a strip after a short pause at a sentence's end, a tap puts the words in, nothing mid-sentence (the samples only start sentences); Go deeper's questions; sends nothing |
| `repeat-flow.mjs` | 12 checks: repeats and reminders are separate, "Just this time", ticking a task off (the browser's clock is pinned to 8am: its task reminds at 12:30) |
| `phase1-check.mjs` | 18 checks of UX phase 1 (branch revamp-5-ux): under Reduce Motion, a fade still plays, nothing slides and Hold to stop needs the hold; "Saved to Notes" goes; deleting a task never says "could not be found"; "All done"; Go deeper remembers Not now; Search shows more; the areas sheet says why a name can't be used; renaming the chosen area resets Life's filter |
| `phase3-check.mjs` | 23 checks of UX phase 3, the note page while writing (writing in the words stands in for the keyboard): Go deeper, Tasks, Done and the tools stay there and fade into each other, and the words don't move; the ⋯ menu floats, fades and closes on a tap outside; a new page opens to write, with its time from the first frame, ⋯ fading in once saved, word help's strip taking no room, and Go deeper once written; Today's question keeps its row; sends nothing |
| `phase4-check.mjs` | 15 checks of UX phase 4, frame by frame: on Today what's under the list glides as a task leaves and as Done opens, the ticked row stays ticked until it's gone, Focus's words cross-fade; on a task's page a repeat's check fills then eases back, no How it's going with nothing to read, Start focus fades and the rest glides; in Life Done moves with the rows and an unticked task fades in; today's page settles over a moment; sends nothing |
| `rows-shots.mjs` | screenshots of Today's rows in each look (`?rows=now,card,sequence,journal`, see `src/ui/rowLook.ts`), light and dark, with eight tasks today; into `/root/projects/uximprove/tasks/round2` (LOOKS, SCHEMES, OUT) |
| `tab-open.mjs` | Today, Notes and Life always open: 150 tab taps in random orders and speeds, some while tabs are drawn ahead; after each settled tap the bar and the page on top agree, the page is fully shown and the tab bar's veil has lifted (ROUNDS, SEED) |
| `filter-swap.mjs` | 22 checks of the calm swap (UX phase 2) on Life, Notes and Search: the list fades rather than cuts, its rows change only while it's invisible, it dips and rises and ends in place; the ring travels and ends on the chosen chip; rapid taps settle on the last; Notes' chips unfold smoothly; Search changes once typing pauses |
| `filter-lag.mjs` | how long an area chip takes on Life and Notes, from the press: until the chip shows it and until the rows on screen are right (samples ×4, CPU 4× slower; PROFILE=1 for a CPU profile) |
| `smoke.mjs` | the app opens; Today, Notes and Life show; how long each switch takes |
| `tab-feel.mjs` | each tab is on screen quickly after a quiet moment, and fades in (the tab bar's veil lifting) |
| `lazy-check.mjs` | whether a first visit to a tab fetches code (it doesn't) |
| `tab-profile.mjs` | tab-switch timings with the samples grown to a real account's size, optionally with a CPU profile; heavy, needs memory |
| `life-growth.mjs` | Life's first draw against the number of tasks (written, never run) |
| `auth.js`, `auth_shots.js` | sign-in screens |

## Live server checks (as the test account)

| Script | What it checks |
|---|---|
| `account-check.mjs` | 15 checks of Sage on your data's screens |
| `offline-check.mjs` | 19 offline checks: airplane mode, a restart with the server blocked, area remap |
| `note-open.mjs` | 8 checks of opening a note, frame by frame: its title from the first frame, Go deeper there from the start, the words fading in without moving |
| `words-account.mjs` | 14 checks of word help with AI help on: a pause mid-sentence brings both rows within a few seconds; typing the start of a way to finish keeps it, with no new ask; a pick puts in the rest, the strip stays and new words are asked for at once; a full stop leaves the starts. `SERVER=http://localhost:3399` sends the suggestion asks to a server run locally (the rest goes live) |
| `tick-account.mjs` | 4 checks: a task ticked on Today stays ticked until it leaves, with the server's answer held back 600 ms; done on the server; writes one "Sage check" area and task and removes them |
| `suggest-timing.mjs` | how long `suggestions/generate` takes, per kind of text (`ROUNDS`, `MODES=all,words,questions`, `SERVER`), with the server's own `Server-Timing` (context, model) where it gives it; writes nothing |
| `editor-account.mjs` | 16 note checks: one create and one save on leaving, rich text stored as a document, reopened with it, deleted from its menu, nothing else touched |
| `ai-account.mjs` | 40 checks of AI help: asked about once after skipping the opening screens; off, nothing goes to an AI endpoint (writing, a note left, its tasks, a task's page, Focus); on, how it's going, first steps, a quiet title and one index on leaving an untitled note, Find tasks, word help (one ask per pause, a tap puts the words in), Go deeper asking only when another question is wanted; off again, nothing |
| `firstrun-ai.mjs` | 11 checks of the opening screens' AI page on a new phone: what it says, Turn on AI help and Not now each kept in Settings; writes nothing |
| `remind-check.mjs` | 6 checks: "just this time" kept by the server; AI answering through zero-retention endpoints |
| `API=live api-check.mjs` | 16 checks of the API changes (migration 014's) |
| `event-check.mjs` | 4 checks: with Learn from my writing off, a suggestion event is answered "not recorded"; the setting is put back as it was |
| `clean-test-account.mjs`, `peek-test-account.mjs` | remove "Sage check" items; look at what's there |

## Database (production, through `railway run`)

| Script | What it does |
|---|---|
| `db-counts.mjs`, `db-counts-real.mjs`, `db-doc-types.mjs` | read-only counts, before and after a change |
| `backup-real-accounts.mjs` | real accounts' rows to an owner-only file in `/root/.config/clarity-backups` |
| `apply-014.mjs`, `apply-015-016.mjs` | the migrations as they were applied (all applied by 2026-10-06), one step per run, with `--check` |
| `doc-encoding-check.mjs` | how jsonb writes land, on a temporary table |
| `zdr-check.mjs` | OpenRouter with zero data retention: provider and speed |
| `event-rows.mjs` | the test account's "Sage check" suggestion events (event-check's), read-only |
