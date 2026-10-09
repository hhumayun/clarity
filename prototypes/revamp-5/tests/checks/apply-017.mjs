// Migration 017 (photos in notes, docs/photos-server.md 3.1 and 12 step 3) on the database in
// DATABASE_URL. Production only through `railway run`, and only with the user's OK:
//   cd /root/projects/clarity && railway run --service clarity-notes --environment production \
//     node /root/projects/clarity-revamp-5/tests/checks/apply-017.mjs --check
//
//   node apply-017.mjs --check      prints the state (which of the four tables exist, the link count,
//                                   the notes naming attachment:) and changes nothing
//   node apply-017.mjs              runs the file (its own BEGIN/COMMIT, one connection), prints the state
//                                   again, and fails loudly unless all four tables exist and the link
//                                   count equals the distinct (note, id) pairs named in notes' content and doc
//   node apply-017.mjs --rollback   drops the four tables in one transaction, but only when attachments and
//                                   storage_deletions are empty AND the live server answers 404 to
//                                   GET /_api/attachments/usage signed out (the code that writes
//                                   note_attachments isn't deployed; a 401 means it is). --server <url>
//                                   asks another server instead (for trying it on a local database).
// It never prints DATABASE_URL.
import { readFileSync } from "node:fs";
import postgres from "/root/projects/clarity/node_modules/postgres/src/index.js";

const FILE = "/root/projects/clarity-revamp-5-ux/migrations/017_attachments.sql";
const LIVE = "https://clarity-notes-production.up.railway.app";
const TABLES = ["attachments", "note_attachments", "storage_deletions", "maintenance_leases"];
const args = process.argv.slice(2);
const mode = args.includes("--rollback") ? "rollback" : args.includes("--check") ? "check" : "apply";
const server = args.includes("--server") ? args[args.indexOf("--server") + 1] : LIVE;

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (run through railway run, or point it at a local database)");
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const sql = postgres(url, { ssl: local ? false : "require", max: 1, prepare: false, onnotice: () => {} });

async function state() {
  const present = (await sql`select table_name from information_schema.tables where table_schema = 'public' and table_name in ${sql(TABLES)}`).map((r) => r.table_name);
  const [named] = await sql`
    select count(distinct n.id)::int as notes, count(distinct (n.id, m[1]))::int as pairs
    from notes n, regexp_matches(n.content || ' ' || coalesce(n.doc::text, ''), 'attachment:([A-Za-z0-9-]{8,64})', 'g') as m`;
  let links = null;
  let photos = null;
  let queued = null;
  if (present.includes("note_attachments")) links = (await sql`select count(*)::int as n from note_attachments`)[0].n;
  if (present.includes("attachments")) photos = (await sql`select count(*)::int as n from attachments`)[0].n;
  if (present.includes("storage_deletions")) queued = (await sql`select count(*)::int as n from storage_deletions`)[0].n;
  return { tables: TABLES.filter((t) => present.includes(t)), notesNamingPhotos: named.notes, namedPairs: named.pairs, links, photos, queuedDeletions: queued };
}

let exitCode = 0;
try {
  const before = await state();
  console.log("before:", JSON.stringify(before));
  if (mode === "apply") {
    await sql.unsafe(readFileSync(FILE, "utf8"));
    const after = await state();
    console.log("after: ", JSON.stringify(after));
    const good = after.tables.length === TABLES.length && after.links === after.namedPairs;
    if (!good) {
      console.error(`FAILED: ${after.tables.length}/4 tables; ${after.links} links for ${after.namedPairs} named (note, photo) pairs`);
      exitCode = 1;
    } else console.log("017 applied: four tables, every named (note, photo) pair linked");
  } else if (mode === "rollback") {
    if (before.photos > 0 || before.queuedDeletions > 0) {
      console.error(`refusing: attachments has ${before.photos} rows and storage_deletions ${before.queuedDeletions}; photos are in use`);
      exitCode = 1;
    } else {
      const status = await fetch(`${server}/_api/attachments/usage`).then((r) => r.status).catch(() => 0);
      if (status !== 404) {
        console.error(`refusing: ${server} answers ${status || "nothing"} to /_api/attachments/usage (404 needed: the photo code must not be deployed, or every note save would fail)`);
        exitCode = 1;
      } else {
        await sql.begin(async (tx) => {
          for (const t of TABLES) await tx.unsafe(`drop table if exists ${t}`);
        });
        console.log("after: ", JSON.stringify(await state()));
        console.log("017 rolled back: the four tables are gone");
      }
    }
  }
} finally {
  await sql.end();
}
process.exit(exitCode);
