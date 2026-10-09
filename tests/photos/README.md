# Photo checks: the local stack

The test stack for photos in notes (`docs/photos-server.md`, sections 11 and 12). Everything here runs
on this machine: the REAL `server.ts` with a local database and a local S3. Only Clerk is production's,
and only for signing in as the test account and checking its tokens. Nothing here writes to production.

| Piece | Where | What |
|---|---|---|
| database | `127.0.0.1:5440` | PGlite (Postgres in WebAssembly) behind `pg-batch-server.mjs`, in memory; migrations 001-017 (003 skipped: 001 already has its constraints) |
| S3 | `127.0.0.1:9400` | versitygw v1.8.0 (MinIO's server binaries are no longer published: dl.min.io answers 410), files in `/root/.cache/photos-s3`; bucket `clarity-photos-local`, CORS for `http://localhost:8095` |
| server | `localhost:3410` | `server.ts` through `run-server.sh`: `env -i`, `DATABASE_URL` to PGlite, `PHOTOS_*` to the local S3, Clerk's two keys read from Railway at run time (never printed, never in a file) |
| web proxy | `localhost:8095` | a second `scripts/web-proxy.mjs` from `/root/projects/clarity-revamp-5`: Sage's web build from Metro (8087, only read from) with `/_api` sent to `:3410` |
| web app | `localhost:9401` | `web-serve.mjs`: the web app (`pages/`) from this worktree through Vite's dev server, `/_api` sent to `:3410`; Clerk's publishable key (dev instance) read from Railway at run time |

Logs and pids: `/root/.cache/photos-stack` (`pg.log`, `s3.log`, `server.log`, `proxy.log`). Nothing is written inside the repo but `node_modules`.

## Start and stop

```bash
cd /root/projects/clarity-revamp-5-ux/tests/photos
npm install                        # once: pglite 0.5.8, postgres 3.4.9, @aws-sdk/client-s3 3.1148.0, playwright-core, superjson
./stack.sh start                   # database + migrations + S3 + bucket and CORS (each only if not up)
./run-server.sh --background       # the real server on :3410 (needs the railway CLI signed in)
./stack.sh proxy                   # Sage's web build at http://localhost:8095 against it
./stack.sh web                     # the web app (pages/) at http://localhost:9401 against it
node smoke.mjs --signed-in         # proves it all (15 checks)

./stack.sh status
./stack.sh stop                    # stops web app 9401, proxy 8095, server 3410, S3 9400, database 5440 (by PID)
```

Other commands: `./run-server.sh --stop`, `./run-server.sh --background --photos-off` (no `PHOTOS_*`),
`./stack.sh s3-stop` / `s3-start`, `./stack.sh reset-db` (a fresh database: everything in it is lost),
`./stack.sh proxy-stop`, `./stack.sh web-stop`.

The database is in memory: stopping it loses its rows (`./stack.sh start` makes a fresh one with every
migration). `PGDATA=<dir>` on `pg-batch-server.mjs` keeps them, if ever wanted.

**PGlite is one session.** `pg-batch-server.mjs` shares it between the server's three connections and
the checks' own: messages are batched per Sync, and a client with an open transaction holds the
database until it ends. So code that queries through `db` while its own transaction is open would hang
here (not on Neon), and races prove nothing here (`race-check.mjs` needs a real Postgres).

## The checks

The test account: `clarity-sage+clerk_test@example.com` (code 424242), read from
`/root/.config/clarity-sage-test.env`. Its rows in the local database are made by the local server on
its first request; the user's own items ("Good boy", the "Dr Lee" tasks, their note) live only in
production and can't be reached from here.

| File | Design | Run |
|---|---|---|
| `smoke.mjs` | 11.1 | `node smoke.mjs [--signed-in]`: the stack is up and wired |
| `api-check.mjs` | 11.2 checks 1-15, 18, 20, 21 | `node api-check.mjs` (`--only 2,3,9`, `--no-restarts`); then runs `sweep-check.ts` and `ai-clean.ts` |
| `sweep-check.ts` | 11.2 checks 16, 17, 24 | `cd ../.. && node node_modules/.bin/tsx tests/photos/sweep-check.ts` (stops and restarts the S3 once) |
| `ai-clean.ts` | 11.2 check 19 | `cd ../.. && node node_modules/.bin/tsx tests/photos/ai-clean.ts` (fetch replaced: nothing reaches OpenRouter) |
| `migration-check.mjs` | 12 step 3 | `node migration-check.mjs`: Sage's `apply-017.mjs` on the local database: `--check`, apply again, both `--rollback` refusals, a real rollback (a stand-in server answers 404), re-apply with links rebuilt from content and doc. Needs no photo rows in the database (api-check's reset leaves none) |
| `web-editor-check.mjs` | 10.2 | `node web-editor-check.mjs` with `./stack.sh web` up: the web app's note editor and notes list in Chrome, signed in as the test account |
| `race-check.mjs` | 11.5 | the six races on a real, throwaway Postgres (below); refuses PGlite, non-local and busy databases |
| `call.ts` | | runs one exported function of a server helper in a tsx process (the sweep, `deleteAccountData`, a 1-second link) |
| `lib.mjs`, `local-env.sh` | | shared addresses, sign-in, database and S3 helpers |

In Sage's checks (`/root/projects/clarity-revamp-5/tests/checks`):

| File | Design | Run |
|---|---|---|
| `photo-account.mjs` | 11.3 | `node tests/checks/photo-account.mjs` with this stack and the proxy up: Sage's photo flow against the local server |
| `photo-live.mjs` | 12 step 7 | **after go-live only, with the user's OK**: end to end against production as the test account |
| `apply-017.mjs` | 12 step 3 | `--check` / apply / `--rollback`; production only through `railway run`, with the user's OK |
| `bucket-cors.mjs` | 12 step 4 | through `railway run`, with the user's OK; `--show`, `--delete` |

Check 22 (the existing checks against the local server, and typecheck):

```bash
cd /root/projects/clarity-revamp-5/tests/checks && API=http://localhost:3410 node api-check.mjs
cd /root/projects/clarity-revamp-5-ux && npx tsc --noEmit 2>&1 | grep -v '^mobile/'
```

Check 23 (the main app's request shape) is left out: the main app is no longer in scope (2026-10-09).

Where a check needs time to pass it moves timestamps in the local database (`upload_started_at`,
`orphaned_since`, `not_before`) instead of waiting. A second user (`clerk_id 'local-other'`) is a row
inserted straight into the local `users` table; it never signs in. Account deletion is checked only
through `deleteAccountData` on a throwaway local user, never through `/_api/account/delete` (that would
delete the shared Clerk user).

## Races on a real Postgres

`race-check.mjs` needs a real Postgres: the user approved `embedded-postgres` from npm, for these tests
only, in a folder outside every project and deleted afterwards (nothing system-wide, nothing left
running). How it was run on 2026-10-09:

```bash
D=/root/.cache/photos-race; mkdir -p $D && cd $D
echo '{"private":true}' > package.json && npm install embedded-postgres@17.10.0-beta.17
(cd node_modules/@embedded-postgres/linux-x64 && node scripts/hydrate-symlinks.js)   # its postinstall
BIN=$D/node_modules/@embedded-postgres/linux-x64/native/bin
# Postgres won't run as root: a user namespace maps root to "nobody" for it alone (no system user made).
mkdir -m 700 data && unshare --user --map-user=65534 --map-group=65534 $BIN/initdb -D $D/data -U postgres --auth=trust -E UTF8 --locale=C.UTF-8
(setsid unshare --user --map-user=65534 --map-group=65534 $BIN/postgres -D $D/data -p 5450 \
  -c listen_addresses=127.0.0.1 -c unix_socket_directories=$D/data > $D/pg.log 2>&1 < /dev/null &)

cd /root/projects/clarity-revamp-5-ux/tests/photos
export CHECK_PG_PORT=5450 CHECK_SERVER_PORT=3420 CHECK_BUCKET=clarity-photos-race PHOTOS_STACK_DIR=$D/stack
DATABASE_URL=postgres://postgres@localhost:5450/postgres node migrate.mjs
PHOTOS_BUCKET=clarity-photos-race node bucket-setup.mjs     # its own bucket: its daily pass claims meta/owner
./run-server.sh --background                               # the real server on :3420 against :5450
RACE_DATABASE_URL=postgres://postgres@localhost:5450/postgres node race-check.mjs --i-made-this-database   # [--per-mode 5] [--only 1,3]
node api-check.mjs                                         # the other checks against it too
```

Then stop the server on :3420 and the Postgres on :5450 (by PID), empty and delete the bucket
`clarity-photos-race` from the S3's data folder, and delete `$D`. `CHECK_PG_PORT`, `CHECK_SERVER_PORT`,
`CHECK_BUCKET` and `PHOTOS_STACK_DIR` are read by `local-env.sh`, `lib.mjs`, `sweep-check.ts` and
`ai-clean.ts`; unset, everything is the PGlite stack's as above.

Each race runs in several modes, round-robin: **natural** (both sides at once; the sweep is a `call.ts`
process loaded beforehand with `CALL_WAIT_FOR_GO=1`, so it starts within milliseconds of the request)
and **gated** (a trigger made by the check in the throwaway database, and dropped at the end, pauses one
side inside its transaction at a chosen write on an advisory lock the check holds; the check sees it
waiting in `pg_locks`, runs the other side until it ends or waits on a row lock, then lets the first
go). Where the interleaving decides the winner, the check also asserts which side wins. The modes:

| Race | Modes |
|---|---|
| 1. two starts over the quota | natural; first paused after its insert (second waits on the user's row) |
| 2. save naming an orphan vs sweep | natural; save paused after its link (sweep wins); save holding the row (save wins); sweep holding the row (sweep wins) |
| 3. start refreshing vs sweep expiring | natural; start holding the row (kept); sweep holding the row (remade, old key queued) |
| 4. confirm vs sweep | natural; confirm holding the row (ready, object there); sweep holding the row (NOT_FOUND, key queued) |
| 5. two sweeps | natural; first paused taking the lease; first paused mid-run (the second finds the lease taken) |
| 6. two saves on one note | natural; first paused after its links (B commits last; both photos kept) |

2026-10-09: five runs, 28 rounds per mode, all passed. To check that the checks can fail: without the
user's row lock in `start`, race 1 failed (two 200s, in natural rounds too); without `skip locked` and
the repeated conditions in the sweep's step 1, races 3 and 4 failed (a link for a deleted row; confirm
200 with no row).
