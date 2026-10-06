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
| `words-flow.mjs` | 14 checks of word help: no strip while writing, a strip after a pause at a sentence's end, a tap puts the words in, nothing mid-sentence; Go deeper's questions; sends nothing |
| `repeat-flow.mjs` | 12 checks: repeats and reminders are separate, "Just this time", ticking a task off (the browser's clock is pinned to 8am: its task reminds at 12:30) |
| `phase1-check.mjs` | 18 checks of UX phase 1 (branch revamp-5-ux): under Reduce Motion, a fade still plays, nothing slides and Hold to stop needs the hold; "Saved to Notes" goes; deleting a task never says "could not be found"; "All done"; Go deeper remembers Not now; Search shows more; the areas sheet says why a name can't be used; renaming the chosen area resets Life's filter |
| `filter-lag.mjs` | how long an area chip takes on Life and Notes, from the press: until the chip shows it and until the rows on screen are right (samples ×4, CPU 4× slower; PROFILE=1 for a CPU profile) |
| `smoke.mjs` | the app opens; Today, Notes and Life show; how long each switch takes |
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
