// The race checks for photos (docs/photos-server.md 11.5), on a REAL Postgres: PGlite (the local
// stack's database) runs one statement at a time, so every race there is won in order and passes
// without testing anything. Never point it at production's database.
//
// Each race runs in several MODES, round-robin, so every interleaving that matters really happens:
//   natural   both sides fired at once (the sweep in a process loaded beforehand, so it starts within
//             milliseconds of the request), with a few ms of random skew either way;
//   gated     one side is paused INSIDE its transaction at a chosen write (a "gate": a trigger, made
//             here in the throwaway database only, that waits on an advisory lock this check holds);
//             the check sees it waiting (pg_locks), runs the other side until it finishes or is
//             itself waiting on a row lock (pg_stat_activity), then lets the first go.
// The gates and their triggers are dropped at the end.
//
// Set-up (README.md, "Races on a real Postgres"):
//   1. an EMPTY throwaway Postgres with migrations 001-017 (migrate.mjs works on any localhost database);
//   2. the real server against it: CHECK_PG_PORT=<port> CHECK_SERVER_PORT=<port> CHECK_BUCKET=<bucket>
//      ./run-server.sh --background (a bucket of its own, so its daily pass never claims the stack's);
//   3. the same CHECK_* variables, and
//      RACE_DATABASE_URL=<that database> node race-check.mjs --i-made-this-database [--per-mode 5] [--only 1,3]
//
// It refuses to run against the local PGlite (:5440), against a database with more than 5 users, or
// when the server under test isn't using the same database (it writes a marker note straight into the
// database and looks for it through the API). Signs in as the Clerk test account through the web
// proxy on :8095, like api-check.mjs; requests go to SERVER (CHECK_SERVER_PORT).
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { join } from "node:path";
import postgres from "postgres";
import { signIn, ok, results, group, photoBytes, newId, headKey, HERE, ROOT, NODE, LOCAL, SERVER, sleep } from "./lib.mjs";

const args = process.argv.slice(2);
const DB = process.env.RACE_DATABASE_URL;
const PER_MODE = args.includes("--per-mode") ? Number(args[args.indexOf("--per-mode") + 1]) : 5;
const ONLY = args.includes("--only") ? new Set(args[args.indexOf("--only") + 1].split(",").map(Number)) : null;
const want = (n) => !ONLY || ONLY.has(n);
if (!DB || !args.includes("--i-made-this-database")) {
  console.error("usage: RACE_DATABASE_URL=<an empty, throwaway Postgres> node race-check.mjs --i-made-this-database");
  process.exit(2);
}
if (/:5440\//.test(DB)) {
  console.error("refusing: that is the local PGlite, which can't run two statements at once (the races would prove nothing)");
  process.exit(2);
}
if (!/@(localhost|127\.0\.0\.1):\d+\//.test(DB)) {
  console.error("refusing: the race checks add test triggers to the database; only a local throwaway Postgres");
  process.exit(2);
}
// The sweeps started here run the daily pass every round (reset() clears its lease): in the stack's
// bucket they would claim its meta/owner for this database and drain keys there. A bucket of its own.
if (!process.env.CHECK_BUCKET || process.env.CHECK_BUCKET === "clarity-photos-local" || !process.env.CHECK_SERVER_PORT) {
  console.error("refusing: set CHECK_BUCKET to a bucket of this run's own (not clarity-photos-local) and CHECK_SERVER_PORT to its server (README.md)");
  process.exit(2);
}
const db = postgres(DB, { max: 4, prepare: false, ssl: false, onnotice: () => {} });
const [{ n: userCount }] = await db`select count(*)::int as n from users`;
if (userCount > 5) {
  console.error(`refusing: ${userCount} users in that database; the race checks want a throwaway one`);
  await db.end();
  process.exit(2);
}
const [{ v: pgVersion }] = await db`select current_setting('server_version') as v`;
console.log(`race-check: Postgres ${pgVersion}, server ${SERVER}, ${PER_MODE} rounds per mode`);

// --- gates ------------------------------------------------------------------------

const GATE_CLASS = 4242;
const GATES = [
  ["attachments", "insert"], ["attachments", "update"], ["attachments", "delete"],
  ["note_attachments", "insert"], ["maintenance_leases", "insert"],
];
async function installGates() {
  await db`create table if not exists race_gates (name text primary key)`;
  await db.unsafe(`
    create or replace function race_gate() returns trigger language plpgsql as $$
    begin
      if exists (select 1 from race_gates where name = TG_ARGV[0]) then
        perform pg_advisory_xact_lock(${GATE_CLASS}, hashtext(TG_ARGV[0]));
      end if;
      return null;
    end $$`);
  for (const [table, op] of GATES) {
    await db.unsafe(`drop trigger if exists race_gate_${op} on ${table}`);
    await db.unsafe(`create trigger race_gate_${op} after ${op} on ${table} for each row execute function race_gate('${table}:${op}')`);
  }
}
async function removeGates() {
  for (const [table, op] of GATES) await db.unsafe(`drop trigger if exists race_gate_${op} on ${table}`);
  await db`drop function if exists race_gate()`;
  await db`drop table if exists race_gates`;
}

/** Polls until fn() is true; throws after `ms`. */
async function until(what, fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(3);
  }
  throw new Error(`timed out waiting for ${what}`);
}
const atGate = async () => (await db`select count(*)::int as n from pg_locks where locktype = 'advisory' and classid = ${GATE_CLASS} and not granted`)[0].n > 0;
/** Backends (not this check's) waiting on a row or transaction lock. */
const rowLockWaiters = async () => (await db`
  select count(*)::int as n from pg_stat_activity
  where datname = current_database() and pid <> pg_backend_pid()
    and wait_event_type = 'Lock' and wait_event <> 'advisory'`)[0].n;

/**
 * Runs `first` until it reaches the gate `name` (paused in its transaction), then `second`; waits until
 * `second` is either finished or blocked on a lock, then opens the gate. Answers both results.
 */
async function gated(name, first, second) {
  const holder = await db.reserve();
  try {
    await holder`select pg_advisory_lock(${GATE_CLASS}, hashtext(${name}))`;
    await db`insert into race_gates (name) values (${name}) on conflict do nothing`;
    const a = first();
    let aDone = false;
    a.finally(() => (aDone = true)).catch(() => {});
    await until(`${name}: the first side at the gate`, async () => {
      if (aDone) throw new Error(`${name}: the first side finished without reaching the gate`);
      return atGate();
    });
    // Only the first side is paused: the second passes the same trigger freely.
    await db`delete from race_gates where name = ${name}`;
    const waitersBefore = await rowLockWaiters();
    const b = second();
    let bDone = false;
    b.finally(() => (bDone = true)).catch(() => {});
    let blocked = false;
    await until(`${name}: the second side finished or blocked`, async () => {
      if (bDone) return true;
      if ((await rowLockWaiters()) > waitersBefore) { blocked = true; return true; }
      return false;
    });
    await holder`select pg_advisory_unlock(${GATE_CLASS}, hashtext(${name}))`;
    const [ra, rb] = await Promise.all([a, b]);
    return { a: ra, b: rb, secondBlocked: blocked };
  } finally {
    await db`delete from race_gates where name = ${name}`.catch(() => {});
    await holder`select pg_advisory_unlock_all()`.catch(() => {});
    holder.release();
  }
}

// --- the sweep, loaded beforehand in its own process ----------------------------------

/** A sweep process, loaded and waiting; `.go()` starts the run and answers { code, report }. */
function sweepWorker() {
  const env = { PATH: "/opt/node24/bin:/usr/bin:/bin", HOME: process.env.HOME, ...LOCAL, DATABASE_URL: DB, ATTACHMENT_SWEEP_EVERY_MS: "0", CALL_WAIT_FOR_GO: "1" };
  const child = spawn(NODE, [join(ROOT, "node_modules/.bin/tsx"), join(HERE, "call.ts"), "helpers/attachmentSweep.tsx", "sweepAttachments", "[{}]"], { cwd: ROOT, env, stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let err = "";
  let readyResolve;
  const ready = new Promise((r) => (readyResolve = r));
  child.stdout.on("data", (d) => { out += d; if (out.includes("READY")) readyResolve(); });
  child.stderr.on("data", (d) => (err += d));
  const done = new Promise((resolve) => child.on("close", (code) => {
    readyResolve();
    const line = out.split("\n").reverse().find((l) => l.startsWith("RESULT "));
    resolve({ code, report: line ? JSON.parse(line.slice(7)) : null, err: err.trim().split("\n").slice(-2).join(" | ") });
  }));
  return { ready, go: () => { child.stdin.write("go\n"); child.stdin.end(); return done; }, kill: () => child.kill() };
}
const didWork = (report) => !!report && !report.skipped && ["expired", "orphans", "drained", "repaired"].some((k) => report[k] > 0);
/** Fires a and b at nearly the same moment, with up to `skew` ms between them either way. */
async function together(a, b, skew = 15) {
  const d = Math.floor(Math.random() * (2 * skew + 1)) - skew;
  const pa = (async () => { if (d < 0) await sleep(-d); return a(); })();
  const pb = (async () => { if (d > 0) await sleep(d); return b(); })();
  return Promise.all([pa, pb]);
}

// start/confirm share a per-user brake of 60 a minute in the server: stay under it.
const uploadCalls = [];
async function throttle(n = 1) {
  for (;;) {
    const now = Date.now();
    while (uploadCalls.length && uploadCalls[0] < now - 61_000) uploadCalls.shift();
    if (uploadCalls.length + n <= 55) { for (let i = 0; i < n; i++) uploadCalls.push(now); return; }
    await sleep(uploadCalls[0] + 61_000 - now);
  }
}

const tally = (counts, key) => (counts[key] = (counts[key] ?? 0) + 1);
const show = (counts) => Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ");

let S;
try {
  S = await signIn();
  const api = S.api;
  const [me] = await db`select id from users where email = ${S.email}`;
  if (!me) throw new Error("the server made no users row in this database: is it running against it?");
  const marker = `Race marker ${randomUUID()}`;
  const [m] = await db`insert into notes (user_id, title, content) values (${me.id}, ${marker}, '') returning id`;
  const listed = await api("GET", "/_api/notes/list");
  await db`delete from notes where id = ${m.id}`;
  if (!JSON.stringify(listed.data ?? {}).includes(marker)) throw new Error("the server doesn't see this database: stopping");
  await installGates();
  const u = me.id;
  const reset = async () => {
    await db`delete from note_attachments where user_id = ${u}`;
    await db`delete from attachments where user_id = ${u}`;
    await db`delete from notes where user_id = ${u} and title like 'Race check%'`;
    await db`delete from storage_deletions where storage_key like ${`u/${u}/%`}`;
    await db`delete from maintenance_leases where name <> 'bucket-owner'`;
  };
  const start = async (id, bytes) => { await throttle(); return api("POST", "/_api/attachments/start", { id, contentType: "image/jpeg", bytes }); };
  const confirm = async (id) => { await throttle(); return api("POST", "/_api/attachments/confirm", { id }); };
  const rounds = (modes) => Array.from({ length: modes.length * PER_MODE }, (_, r) => ({ r, mode: modes[r % modes.length] }));

  if (want(1)) await group("1. two starts at once that together pass the quota: one succeeds", async () => {
    let bad = 0;
    const seen = {};
    for (const { r, mode } of rounds(["natural", "gated"])) {
      await reset();
      // 1 GB less 5 MB used, in rows of at most 10 MB: room for one 3 MB photo, not two.
      await db`insert into attachments (user_id, id, content_type, bytes, storage_key, status, confirmed_at)
        select ${u}, 'fill-' || lpad(g::text, 4, '0'), 'image/jpeg', 10485760, ${`u/${u}/fill-`}::text || g::text || '/x', 'ready', now() from generate_series(1, 101) g`;
      await db`insert into attachments (user_id, id, content_type, bytes, storage_key, status, confirmed_at) values (${u}, 'fill-rest', 'image/jpeg', ${1073741824 - 101 * 10485760 - 5 * 1048576}, ${`u/${u}/fill-rest/x`}, 'ready', now())`;
      const ida = newId("qa");
      const idb = newId("qb");
      await throttle(2);
      const raw = (id) => api("POST", "/_api/attachments/start", { id, contentType: "image/jpeg", bytes: 3 * 1048576 });
      let a, b, note = "";
      if (mode === "natural") [a, b] = await together(() => raw(ida), () => raw(idb));
      else {
        // The first start paused after its insert (holding the user's row); the second must wait for it.
        const g = await gated("attachments:insert", () => raw(ida), () => raw(idb));
        ({ a, b } = g);
        note = g.secondBlocked ? "" : " (the second didn't wait)";
      }
      const statuses = [a.status, b.status].sort().join(",");
      const [{ n: newRows }] = await db`select count(*)::int as n from attachments where user_id = ${u} and id in (${ida}, ${idb})`;
      const codeOk = [a, b].some((x) => x.status === 413 && x.data?.code === "QUOTA_FULL");
      tally(seen, `${mode} ${statuses}`);
      if (statuses !== "200,413" || !codeOk || newRows !== 1 || note) { bad++; console.log(`  round ${r} (${mode}): ${statuses}, ${newRows} new rows${note}`); }
    }
    console.log(`  outcomes: ${show(seen)}`);
    ok("every round: exactly one start succeeded (the other QUOTA_FULL), one new row", bad === 0, `${bad} bad rounds`);
    await reset();
  });

  if (want(2)) await group("2. a save naming an orphan while the sweep deletes it: never both lost", async () => {
    let bad = 0;
    const seen = {};
    for (const { r, mode } of rounds(["natural", "save paused after its link", "save holds the row", "sweep holds the row"])) {
      await reset();
      const id = newId("race");
      await db`insert into attachments (user_id, id, content_type, bytes, storage_key, status, confirmed_at, orphaned_since) values (${u}, ${id}, 'image/jpeg', 10, ${`u/${u}/${id}/x`}, 'ready', now(), now() - interval '8 days')`;
      const w = sweepWorker();
      await w.ready;
      const save = () => api("POST", "/_api/notes/create", { id: randomUUID(), title: "Race check", content: `![](attachment:${id})` });
      let s, sw, blocked = null;
      if (mode === "natural") [s, sw] = await together(save, () => w.go());
      else if (mode === "save paused after its link") ({ a: s, b: sw } = await gated("note_attachments:insert", save, () => w.go()));
      else if (mode === "save holds the row") ({ a: s, b: sw } = await gated("attachments:update", save, () => w.go()));
      else ({ a: sw, b: s, secondBlocked: blocked } = await gated("attachments:delete", () => w.go(), save));
      const [row] = await db`select orphaned_since from attachments where user_id = ${u} and id = ${id}`;
      const [q] = await db`select 1 as q from storage_deletions where storage_key = ${`u/${u}/${id}/x`}`;
      const [link] = await db`select 1 as l from note_attachments where user_id = ${u} and attachment_id = ${id}`;
      const saveWon = !!row && row.orphaned_since === null && !q && !!link;
      const sweepWon = !row && !!q && (s.data?.missingPhotos ?? []).includes(id);
      const outcome = saveWon ? "save won" : sweepWon ? "sweep won" : "BOTH LOST";
      tally(seen, `${mode}: ${outcome}`);
      // Where the interleaving decides the winner, it must be that one.
      const expected = { "save paused after its link": "sweep won", "save holds the row": "save won", "sweep holds the row": "sweep won" }[mode];
      const wrongWinner = expected && outcome !== expected;
      if (s.status !== 200 || sw.code !== 0 || (!saveWon && !sweepWon) || wrongWinner || blocked === false) {
        bad++;
        console.log(`  round ${r} (${mode}): save ${s.status}, sweep exit ${sw.code} ${sw.err ?? ""}, row ${row ? (row.orphaned_since ? "kept, still marked" : "kept") : "gone"}, queued ${!!q}, link ${!!link}, missing ${JSON.stringify(s.data?.missingPhotos)}${expected ? `, expected ${expected}` : ""}${blocked === false ? ", save didn't wait" : ""}`);
      }
    }
    console.log(`  outcomes: ${show(seen)}`);
    ok("every round: the save kept it (mark cleared, linked) or the sweep took it (key queued) and the save lists it missing", bad === 0, `${bad} bad rounds`);
    await reset();
  });

  if (want(3)) await group("3. a start refreshing a pending row while the sweep expires it", async () => {
    let bad = 0;
    const seen = {};
    for (const { r, mode } of rounds(["natural", "start holds the row", "sweep holds the row"])) {
      await reset();
      const id = newId("race");
      const key = `u/${u}/${id}/old`;
      await db`insert into attachments (user_id, id, content_type, bytes, storage_key, upload_started_at) values (${u}, ${id}, 'image/jpeg', 1000, ${key}, now() - interval '25 hours')`;
      const w = sweepWorker();
      await w.ready;
      await throttle();
      const st = () => api("POST", "/_api/attachments/start", { id, contentType: "image/jpeg", bytes: 1000 });
      let s, sw, blocked = null;
      if (mode === "natural") [s, sw] = await together(st, () => w.go());
      else if (mode === "start holds the row") ({ a: s, b: sw } = await gated("attachments:update", st, () => w.go()));
      else ({ a: sw, b: s, secondBlocked: blocked } = await gated("attachments:delete", () => w.go(), st));
      const [row] = await db`select storage_key, status, upload_started_at > now() - interval '1 hour' as fresh from attachments where user_id = ${u} and id = ${id}`;
      const [q] = await db`select 1 as q from storage_deletions where storage_key = ${key}`;
      const kept = row?.storage_key === key && row.fresh && !q;
      const remade = !!row && row.storage_key !== key && row.status === "pending" && !!q;
      const linkKey = s.data?.upload?.url ? new URL(s.data.upload.url).pathname.split("/").slice(2).join("/") : null;
      const linkMatches = !!row && linkKey === row.storage_key;
      const outcome = kept ? "kept" : remade ? "remade" : "BAD";
      tally(seen, `${mode}: ${outcome}`);
      const expected = { "start holds the row": "kept", "sweep holds the row": "remade" }[mode];
      if (s.status !== 200 || sw.code !== 0 || outcome === "BAD" || !linkMatches || (expected && outcome !== expected) || blocked === false) {
        bad++;
        console.log(`  round ${r} (${mode}): start ${s.status}, sweep exit ${sw.code}, row key ${row?.storage_key === key ? "old" : row ? "new" : "none"}, old key queued ${!!q}, link for ${linkMatches ? "the row's key" : linkKey}${expected ? `, expected ${expected}` : ""}${blocked === false ? ", start didn't wait" : ""}`);
      }
    }
    console.log(`  outcomes: ${show(seen)}`);
    ok("every round: the row kept its key (refreshed), or start made a new row and key and the old key was queued; the link is for the row's key", bad === 0, `${bad} bad rounds`);
    await reset();
  });

  if (want(4)) await group("4. confirm while the sweep deletes the row: no ready row without its object", async () => {
    let bad = 0;
    const seen = {};
    for (const { r, mode } of rounds(["natural", "confirm holds the row", "sweep holds the row"])) {
      await reset();
      const id = newId("race");
      const body = photoBytes(1000, r + 1);
      const s = await start(id, body.length);
      const put = await fetch(s.data.upload.url, { method: "PUT", headers: s.data.upload.headers, body });
      if (put.status !== 200) throw new Error(`PUT ${put.status}`);
      const [{ storage_key: key }] = await db`update attachments set upload_started_at = now() - interval '25 hours' where user_id = ${u} and id = ${id} returning storage_key`;
      const w = sweepWorker();
      await w.ready;
      await throttle();
      const cf = () => api("POST", "/_api/attachments/confirm", { id });
      let c, sw, blocked = null;
      if (mode === "natural") [c, sw] = await together(cf, () => w.go());
      else if (mode === "confirm holds the row") ({ a: c, b: sw } = await gated("attachments:update", cf, () => w.go()));
      else ({ a: sw, b: c, secondBlocked: blocked } = await gated("attachments:delete", () => w.go(), cf));
      const [row] = await db`select status, storage_key from attachments where user_id = ${u} and id = ${id}`;
      const [q] = await db`select 1 as q from storage_deletions where storage_key = ${key}`;
      const objectThere = !!(await headKey(key));
      const readyOk = c.status === 200 && c.data?.attachment?.id === id && !!c.data.attachment.confirmedAt && row?.status === "ready" && objectThere && !q;
      const goneOk = c.status === 404 && c.data?.code === "NOT_FOUND" && !row && !!q;
      const outcome = readyOk ? "ready" : goneOk ? "NOT_FOUND" : "BAD";
      tally(seen, `${mode}: ${outcome}`);
      const expected = { "confirm holds the row": "ready", "sweep holds the row": "NOT_FOUND" }[mode];
      if (sw.code !== 0 || outcome === "BAD" || (expected && outcome !== expected) || blocked === false) {
        bad++;
        console.log(`  round ${r} (${mode}): confirm ${c.status} ${c.data?.code ?? ""}, row ${row?.status ?? "none"}, object ${objectThere}, key queued ${!!q}${expected ? `, expected ${expected}` : ""}${blocked === false ? ", confirm didn't wait" : ""}`);
      }
    }
    console.log(`  outcomes: ${show(seen)}`);
    ok("every round: ready with its object and nothing queued, or NOT_FOUND with the row gone and its key queued", bad === 0, `${bad} bad rounds`);
    await reset();
  });

  if (want(5)) await group("5. two sweeps at once: one does the work", async () => {
    let bad = 0;
    const seen = {};
    for (const { r, mode } of rounds(["natural", "first paused taking the lease", "first paused mid-run"])) {
      await reset();
      for (let i = 0; i < 5; i++) {
        const id = newId("race");
        await db`insert into attachments (user_id, id, content_type, bytes, storage_key, upload_started_at) values (${u}, ${id}, 'image/jpeg', 10, ${`u/${u}/${id}/x`}, now() - interval '30 hours')`;
      }
      const w1 = sweepWorker();
      const w2 = sweepWorker();
      await Promise.all([w1.ready, w2.ready]);
      let a, b, blocked = null;
      if (mode === "natural") [a, b] = await together(() => w1.go(), () => w2.go(), 5);
      else if (mode === "first paused taking the lease") ({ a, b, secondBlocked: blocked } = await gated("maintenance_leases:insert", () => w1.go(), () => w2.go()));
      else ({ a, b } = await gated("attachments:delete", () => w1.go(), () => w2.go()));
      const workers = [a, b].filter((x) => didWork(x.report)).length;
      const skipped = [a, b].filter((x) => x.report?.skipped === "leased").length;
      const [{ n }] = await db`select count(*)::int as n from attachments where user_id = ${u}`;
      const [{ q }] = await db`select count(*)::int as q from storage_deletions where storage_key like ${`u/${u}/race-%`}`;
      tally(seen, `${mode}: ${workers} worked, ${skipped} skipped`);
      const strict = mode !== "natural"; // paused mid-lease or mid-run, the second must find the lease taken
      if (a.code !== 0 || b.code !== 0 || workers !== 1 || n !== 0 || q !== 5 || (strict && skipped !== 1) || blocked === false || a.report?.error || b.report?.error) {
        bad++;
        console.log(`  round ${r} (${mode}): exits ${a.code},${b.code}; ${workers} did work; ${skipped} skipped; ${n} rows left; ${q} keys queued; errors ${a.report?.error ?? "-"},${b.report?.error ?? "-"}${blocked === false ? "; the second didn't wait for the lease" : ""}`);
      }
    }
    console.log(`  outcomes: ${show(seen)}`);
    ok("every round: both ended cleanly, exactly one did the work (each key queued once), and when one was paused the other found the lease taken", bad === 0, `${bad} bad rounds`);
    await reset();
  });

  if (want(6)) await group("6. two saves at once on the same note: the links match the note that committed last", async () => {
    let bad = 0;
    const seen = {};
    const made = await api("POST", "/_api/notes/create", { id: randomUUID(), title: "Race check links", content: "start" });
    const noteId = made.data?.note?.id;
    if (!noteId) throw new Error(`notes/create: ${made.status}`);
    let prev = [];
    for (const { r, mode } of rounds(["natural", "first paused after its links"])) {
      const a = newId("ra");
      const b = newId("rb");
      // The previous round's photos are said removed, so the note stays small; neither save names the other's.
      const save = (tag, id) => () => api("POST", "/_api/notes/update", { id: noteId, content: `${tag} ![](attachment:${id})`, removedPhotos: prev });
      let x, y, blocked = null;
      if (mode === "natural") [x, y] = await together(save("A", a), save("B", b));
      else ({ a: x, b: y, secondBlocked: blocked } = await gated("note_attachments:insert", save("A", a), save("B", b)));
      const [n] = await db`select content from notes where id = ${noteId}`;
      const named = new Set([...n.content.matchAll(/attachment:([A-Za-z0-9-]{8,64})/g)].map((m) => m[1]));
      const links = new Set((await db`select attachment_id from note_attachments where note_id = ${noteId}`).map((l) => l.attachment_id));
      // The save that committed second read the first one's link under the row lock and put its photo back.
      const both = named.has(a) && named.has(b);
      const lastFirst = n.content.startsWith("A") ? "A last" : n.content.startsWith("B") ? "B last" : "?";
      tally(seen, `${mode}: ${lastFirst}${both ? ", both kept" : ""}`);
      const strict = mode !== "natural" && lastFirst !== "B last"; // A was paused, so B commits last
      if (x.status !== 200 || y.status !== 200 || named.size !== links.size || [...named].some((id) => !links.has(id)) || !both || strict || blocked === false) {
        bad++;
        console.log(`  round ${r} (${mode}): saves ${x.status},${y.status}; content names ${[...named]}, links ${[...links]}; ${lastFirst}${blocked === false ? "; B didn't wait" : ""}`);
      }
      prev = [a, b];
    }
    console.log(`  outcomes: ${show(seen)}`);
    ok("every round: the links equal what the stored note names, and neither save's photo was lost", bad === 0, `${bad} bad rounds`);
    await reset();
  });
} catch (error) {
  ok("the race checks ran", false, String(error?.message ?? error).split("\n")[0]);
} finally {
  if (S) await S.close().catch(() => {});
  await removeGates().catch((error) => ok("the test triggers were removed", false, String(error?.message ?? error)));
  await db.end();
  console.log(results.failed ? `\nrace-check: ${results.failed} FAILED, ${results.passed} passed` : `\nrace-check: all ${results.passed} passed`);
  process.exit(results.failed ? 1 : 0);
}
