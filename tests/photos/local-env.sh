# The local stack's addresses (docs/photos-server.md, 11.1). Sourced by
# stack.sh, run-server.sh and the checks. Nothing here is a production value:
# the S3 keys belong to the throwaway versitygw this stack starts on
# 127.0.0.1:9400, and the database is PGlite in a process on 127.0.0.1:5440.
# Clerk's keys are never here; run-server.sh reads them at run time.

PHOTOS_STACK_DIR=${PHOTOS_STACK_DIR:-/root/.cache/photos-stack}   # logs and pids, outside the repo
PHOTOS_S3_DIR=${PHOTOS_S3_DIR:-/root/.cache/photos-s3}            # the versitygw binary and its files

# CHECK_PG_PORT / CHECK_SERVER_PORT / CHECK_BUCKET point the checks at a second database, server and
# bucket (the race run on a throwaway real Postgres, race-check.mjs); unset, the PGlite stack's.
PG_PORT=${CHECK_PG_PORT:-5440}
S3_PORT=9400
SERVER_PORT=${CHECK_SERVER_PORT:-3410}
PROXY_PORT=8095
WEB_PORT=9401   # the web app (pages/) through Vite: ./stack.sh web

LOCAL_DATABASE_URL="postgres://postgres@localhost:${PG_PORT}/postgres"
LOCAL_PHOTOS_BUCKET=${CHECK_BUCKET:-clarity-photos-local}
LOCAL_PHOTOS_ACCESS_KEY_ID=labkey
LOCAL_PHOTOS_SECRET_ACCESS_KEY=labsecret123
LOCAL_PHOTOS_ENDPOINT="http://127.0.0.1:${S3_PORT}"
LOCAL_PHOTOS_REGION=auto

NODE_BIN=${NODE_BIN:-/opt/node24/bin}

# The PID listening on a TCP port, or nothing.
pid_on_port() { { ss -ltnpH "sport = :$1" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2; } || true; }

# Stops whatever listens on a port (by its PID, never by name).
stop_port() {
  local pid; pid=$(pid_on_port "$1")
  [ -z "$pid" ] && return 0
  kill "$pid" 2>/dev/null
  for _ in $(seq 1 50); do [ -z "$(pid_on_port "$1")" ] && return 0; sleep 0.1; done
  kill -9 "$pid" 2>/dev/null; return 0
}

wait_port() { for _ in $(seq 1 "${2:-100}"); do [ -n "$(pid_on_port "$1")" ] && return 0; sleep 0.2; done; return 1; }
