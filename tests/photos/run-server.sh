#!/usr/bin/env bash
# Starts the REAL server.ts on :3410 against the local stack (docs/photos-server.md, 11.1, step 3):
# DATABASE_URL to PGlite on :5440, PHOTOS_* to the local S3 on :9400, and production Clerk's two
# keys, read at run time from Railway and handed only to the process: never printed, never written
# to a file. `env -i` keeps every other variable out, so this server can't reach production's
# database or OpenRouter. The local server makes the test account's users row in the local database
# on its first request.
#
#   ./run-server.sh                 in the foreground
#   ./run-server.sh --background    detached; log in /root/.cache/photos-stack/server.log
#   ./run-server.sh --photos-off    without the PHOTOS_* variables (check 11.2.21); combine with --background
#   ./run-server.sh --stop          stops whatever listens on :3410 (by PID)
#
# Extra variables for the checks pass through when set: ATTACHMENT_SWEEP_EVERY_MS (default 0 here),
# ATTACHMENT_SWEEP_BUDGET_MS, ATTACHMENT_RECONCILE_MIN_AGE_MS.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
. "$HERE/local-env.sh"
mkdir -p "$PHOTOS_STACK_DIR"

BACKGROUND=0; PHOTOS=1
for arg in "$@"; do
  case "$arg" in
    --background) BACKGROUND=1 ;;
    --photos-off) PHOTOS=0 ;;
    --stop) stop_port $SERVER_PORT; echo "server: stopped"; exit 0 ;;
    *) echo "unknown option $arg"; exit 2 ;;
  esac
done

if [ -n "$(pid_on_port $SERVER_PORT)" ]; then echo "server: something already listens on :$SERVER_PORT (./run-server.sh --stop)"; exit 1; fi
if [ -z "$(pid_on_port $PG_PORT)" ]; then echo "the database isn't up: ./stack.sh start"; exit 1; fi
if [ -e "$ROOT/.env" ] || [ -e "$ROOT/env.json" ]; then echo "refusing: $ROOT has a .env or env.json (loadEnv.js would read it)"; exit 1; fi

# Production Clerk's keys, read now, kept in this shell only.
CLERK_VARS=$(cd /root/projects/clarity && railway variables --service clarity-notes --environment production --kv 2>/dev/null \
  | grep -E '^(CLERK_SECRET_KEY|CLERK_PUBLISHABLE_KEY)=' || true)
if [ "$(printf '%s\n' "$CLERK_VARS" | grep -c '^CLERK_')" != 2 ]; then echo "couldn't read Clerk's two keys from Railway (is the railway CLI signed in?)"; exit 1; fi

PHOTO_VARS=()
if [ $PHOTOS = 1 ]; then
  PHOTO_VARS=(PHOTOS_BUCKET="$LOCAL_PHOTOS_BUCKET" PHOTOS_ACCESS_KEY_ID="$LOCAL_PHOTOS_ACCESS_KEY_ID"
    PHOTOS_SECRET_ACCESS_KEY="$LOCAL_PHOTOS_SECRET_ACCESS_KEY" PHOTOS_ENDPOINT="$LOCAL_PHOTOS_ENDPOINT"
    PHOTOS_REGION="$LOCAL_PHOTOS_REGION" PHOTOS_PATH_STYLE=1)
fi
EXTRA=(ATTACHMENT_SWEEP_EVERY_MS="${ATTACHMENT_SWEEP_EVERY_MS:-0}")
[ -n "${ATTACHMENT_SWEEP_BUDGET_MS:-}" ] && EXTRA+=(ATTACHMENT_SWEEP_BUDGET_MS="$ATTACHMENT_SWEEP_BUDGET_MS")
[ -n "${ATTACHMENT_RECONCILE_MIN_AGE_MS:-}" ] && EXTRA+=(ATTACHMENT_RECONCILE_MIN_AGE_MS="$ATTACHMENT_RECONCILE_MIN_AGE_MS")

cd "$ROOT"
# Clerk keys are base64-like with no spaces, so the word splitting of $CLERK_VARS is safe.
# shellcheck disable=SC2086
CMD=(env -i PATH="$NODE_BIN:/usr/bin:/bin" HOME="$HOME" $CLERK_VARS
  PORT=$SERVER_PORT DATABASE_URL="$LOCAL_DATABASE_URL" "${PHOTO_VARS[@]}" "${EXTRA[@]}"
  "$NODE_BIN/node" node_modules/.bin/tsx server.ts)
unset CLERK_VARS

if [ $BACKGROUND = 1 ]; then
  setsid "${CMD[@]}" >"$PHOTOS_STACK_DIR/server.log" 2>&1 < /dev/null &
  if wait_port $SERVER_PORT 150; then echo "server: up on :$SERVER_PORT (photos $([ $PHOTOS = 1 ] && echo on || echo off)); log $PHOTOS_STACK_DIR/server.log"
  else echo "server didn't start; see $PHOTOS_STACK_DIR/server.log"; exit 1; fi
else
  exec "${CMD[@]}"
fi
