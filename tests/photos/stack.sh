#!/usr/bin/env bash
# The local stack for the photo checks (docs/photos-server.md, 11.1):
#   database  PGlite behind pg-batch-server.mjs on 127.0.0.1:5440, migrations 001-017 applied
#   S3        versitygw v1.8.0 on 127.0.0.1:9400, bucket clarity-photos-local with CORS for :8095
# The API server (run-server.sh, :3410) and the web proxy (:8095) are started separately.
#
#   ./stack.sh start      database + migrations + S3 + bucket (each only if not already up)
#   ./stack.sh stop       stops everything this stack runs: web app 9401, proxy 8095, server 3410, S3 9400, database 5440
#   ./stack.sh status     what is up
#   ./stack.sh s3-stop | s3-start     the bucket going away and coming back (check 11.2.20)
#   ./stack.sh reset-db   a fresh in-memory database with all migrations (everything in it is lost)
#   ./stack.sh proxy      Sage's web build at http://localhost:8095 with /_api sent to the local server
#                         (a second scripts/web-proxy.mjs from /root/projects/clarity-revamp-5; Metro on 8087
#                         must be running; it is only read from)
#   ./stack.sh proxy-stop
#   ./stack.sh web        the web app (pages/, Vite dev server from this worktree) at http://localhost:9401,
#                         /_api sent to the local server; Clerk's publishable key read from Railway at run time
#   ./stack.sh web-stop
#
# Logs and pids live in /root/.cache/photos-stack, the S3's files in /root/.cache/photos-s3: outside the repo.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/local-env.sh"
export PATH="$NODE_BIN:$PATH"
mkdir -p "$PHOTOS_STACK_DIR"

# With CHECK_PG_PORT / CHECK_SERVER_PORT set (a second stack, README "Races on a real Postgres"),
# local-env.sh points PG_PORT and SERVER_PORT there: starting PGlite on that port, or stopping
# it, would hit the other stack's database. Only the shared S3's commands (api-check 11.2.20) and status.
if [ -n "${CHECK_PG_PORT:-}${CHECK_SERVER_PORT:-}" ]; then
  case "${1:-}" in
    status|s3-stop|s3-start) ;;
    *) echo "refusing: CHECK_PG_PORT/CHECK_SERVER_PORT are set; only status, s3-stop and s3-start here"; exit 2 ;;
  esac
fi

start_db() {
  if [ -n "$(pid_on_port $PG_PORT)" ]; then echo "database: already up on :$PG_PORT"; return; fi
  [ -d "$HERE/node_modules/@electric-sql/pglite" ] || (cd "$HERE" && npm install --no-audit --no-fund >/dev/null)
  (cd "$HERE" && PORT=$PG_PORT setsid node pg-batch-server.mjs >"$PHOTOS_STACK_DIR/pg.log" 2>&1 < /dev/null &)
  wait_port $PG_PORT || { echo "database didn't start; see $PHOTOS_STACK_DIR/pg.log"; exit 1; }
  echo "database: up on :$PG_PORT"
}

migrate() { (cd "$HERE" && DATABASE_URL="$LOCAL_DATABASE_URL" node migrate.mjs); }

start_s3() {
  if [ -n "$(pid_on_port $S3_PORT)" ]; then echo "S3: already up on :$S3_PORT"; return; fi
  if [ ! -x "$PHOTOS_S3_DIR/versitygw" ]; then
    # MinIO's server binaries are no longer published (dl.min.io answers 410), so versitygw.
    mkdir -p "$PHOTOS_S3_DIR"
    curl -sSfL -o "$PHOTOS_S3_DIR/vgw.tgz" https://github.com/versity/versitygw/releases/download/v1.8.0/versitygw_v1.8.0_Linux_x86_64.tar.gz
    tar xzf "$PHOTOS_S3_DIR/vgw.tgz" -C "$PHOTOS_S3_DIR"
    mv "$PHOTOS_S3_DIR/versitygw_v1.8.0_Linux_x86_64/versitygw" "$PHOTOS_S3_DIR/versitygw"
    rm -rf "$PHOTOS_S3_DIR/vgw.tgz" "$PHOTOS_S3_DIR/versitygw_v1.8.0_Linux_x86_64"
  fi
  mkdir -p "$PHOTOS_S3_DIR/data"
  (ROOT_ACCESS_KEY="$LOCAL_PHOTOS_ACCESS_KEY_ID" ROOT_SECRET_KEY="$LOCAL_PHOTOS_SECRET_ACCESS_KEY" \
    setsid "$PHOTOS_S3_DIR/versitygw" --port 127.0.0.1:$S3_PORT --region "$LOCAL_PHOTOS_REGION" \
    posix "$PHOTOS_S3_DIR/data" >"$PHOTOS_STACK_DIR/s3.log" 2>&1 < /dev/null &)
  wait_port $S3_PORT || { echo "S3 didn't start; see $PHOTOS_STACK_DIR/s3.log"; exit 1; }
  echo "S3: up on :$S3_PORT"
}

bucket() {
  (cd "$HERE" && PHOTOS_ENDPOINT="$LOCAL_PHOTOS_ENDPOINT" PHOTOS_BUCKET="$LOCAL_PHOTOS_BUCKET" \
    PHOTOS_ACCESS_KEY_ID="$LOCAL_PHOTOS_ACCESS_KEY_ID" PHOTOS_SECRET_ACCESS_KEY="$LOCAL_PHOTOS_SECRET_ACCESS_KEY" \
    PHOTOS_REGION="$LOCAL_PHOTOS_REGION" node bucket-setup.mjs)
}

start_proxy() {
  if [ -n "$(pid_on_port $PROXY_PORT)" ]; then echo "web proxy: already up on :$PROXY_PORT"; return; fi
  (cd /root/projects/clarity-revamp-5 && PORT=$PROXY_PORT API="http://localhost:$SERVER_PORT" METRO=http://localhost:8087 \
    setsid node scripts/web-proxy.mjs >"$PHOTOS_STACK_DIR/proxy.log" 2>&1 < /dev/null &)
  wait_port $PROXY_PORT || { echo "web proxy didn't start; see $PHOTOS_STACK_DIR/proxy.log"; exit 1; }
  echo "web proxy: up on :$PROXY_PORT (web build from :8087, /_api to :$SERVER_PORT)"
}

start_web() {
  if [ -n "$(pid_on_port $WEB_PORT)" ]; then echo "web app: already up on :$WEB_PORT"; return; fi
  # Clerk's publishable key (dev instance), read now and handed only to the process.
  local key
  key=$(cd /root/projects/clarity && railway variables --service clarity-notes --environment production --kv 2>/dev/null \
    | grep -E '^VITE_CLERK_PUBLISHABLE_KEY=' | head -1 | cut -d= -f2- || true)
  if [ -z "$key" ]; then echo "couldn't read VITE_CLERK_PUBLISHABLE_KEY from Railway (is the railway CLI signed in?)"; exit 1; fi
  (cd "$HERE" && env -i PATH="$NODE_BIN:/usr/bin:/bin" HOME="$HOME" VITE_CLERK_PUBLISHABLE_KEY="$key" \
    WEB_PORT=$WEB_PORT API="http://localhost:$SERVER_PORT" setsid node web-serve.mjs >"$PHOTOS_STACK_DIR/web.log" 2>&1 < /dev/null &)
  unset key
  wait_port $WEB_PORT 150 || { echo "web app didn't start; see $PHOTOS_STACK_DIR/web.log"; exit 1; }
  echo "web app: up on :$WEB_PORT (pages/ from this worktree, /_api to :$SERVER_PORT)"
}

status() {
  for pair in "database:$PG_PORT" "S3:$S3_PORT" "server:$SERVER_PORT" "web proxy:$PROXY_PORT" "web app:$WEB_PORT"; do
    name=${pair%%:*}; port=${pair##*:}; pid=$(pid_on_port "$port")
    if [ -n "$pid" ]; then echo "$name: up on :$port (pid $pid)"; else echo "$name: down (:$port)"; fi
  done
}

case "${1:-}" in
  start) start_db; migrate; start_s3; bucket ;;
  stop) for p in $WEB_PORT $PROXY_PORT $SERVER_PORT $S3_PORT $PG_PORT; do stop_port "$p"; done; status ;;
  status) status ;;
  s3-stop) stop_port $S3_PORT; echo "S3: stopped" ;;
  s3-start) start_s3 ;;
  reset-db) stop_port $PG_PORT; start_db; migrate ;;
  proxy) start_proxy ;;
  proxy-stop) stop_port $PROXY_PORT; echo "web proxy: stopped" ;;
  web) start_web ;;
  web-stop) stop_port $WEB_PORT; echo "web app: stopped" ;;
  *) echo "usage: $0 start|stop|status|s3-stop|s3-start|reset-db|proxy|proxy-stop|web|web-stop"; exit 2 ;;
esac
