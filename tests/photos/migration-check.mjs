// Migration 017's apply script (/root/projects/clarity-revamp-5/tests/checks/apply-017.mjs,
// docs/photos-server.md 12 step 3) on the LOCAL database only: --check, apply on top of an
// applied database, both refusal paths of --rollback, an actual rollback (a stand-in server on a
// free port answers 404, as production would before the photo code is deployed), then re-apply,
// with the backfill rebuilding links from notes' content and doc.
//
//   node migration-check.mjs          needs ./stack.sh start and ./run-server.sh --background
//
// Works on a throwaway local user ('local-migration'), deleted at the end. A rollback needs
// attachments and storage_deletions empty for EVERY user, so this refuses to start when any
// other user has photo rows. While the four tables are dropped (a second or two) the local
// server's note saves would fail; nothing else should be using the stack while this runs.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { sql, ok, results, section, LOCAL, NODE, SERVER, newId } from "./lib.mjs";

const SCRIPT = "/root/projects/clarity-revamp-5/tests/checks/apply-017.mjs";
const TABLES = ["attachments", "note_attachments", "storage_deletions", "maintenance_leases"];

// Async, so the stand-in server in this process can answer the script's request.
function apply017(...args) {
  return new Promise((resolve) => {
    const child = spawn(NODE, [SCRIPT, ...args], {
      env: { PATH: "/opt/node24/bin:/usr/bin:/bin", HOME: process.env.HOME, DATABASE_URL: LOCAL.DATABASE_URL },
    });
    let text = "";
    child.stdout.on("data", (d) => (text += d));
    child.stderr.on("data", (d) => (text += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 120000);
    child.on("close", (status) => {
      clearTimeout(timer);
      const lines = text.split("\n");
      const parse = (prefix) => {
        const line = lines.find((l) => l.startsWith(prefix));
        return line ? JSON.parse(line.slice(prefix.length).trim()) : null;
      };
      resolve({ status, text, before: parse("before:"), after: parse("after:") });
    });
  });
}
const tables = async () =>
  (await sql`select table_name from information_schema.tables where table_schema = 'public' and table_name in ${sql(TABLES)}`).map((r) => r.table_name);

// A server that answers 404 to everything: the photo code isn't deployed.
const standIn = createServer((_req, res) => { res.statusCode = 404; res.end("not found"); });
let user;
try {
  if (!LOCAL.DATABASE_URL.includes("@localhost:5440/")) throw new Error("not the local database");
  const busy = await sql`select count(*)::int as n from attachments where user_id not in (select id from users where clerk_id = 'local-migration')`;
  const queuedRows = await sql`select count(*)::int as n from storage_deletions`;
  if (busy[0].n > 0 || queuedRows[0].n > 0) throw new Error(`the local database has ${busy[0].n} photo rows and ${queuedRows[0].n} queued deletions; a rollback can't run (./stack.sh reset-db, or let api-check's reset clear them)`);
  await new Promise((resolve, reject) => standIn.once("error", reject).listen(0, "127.0.0.1", resolve));
  const STAND_IN = `http://127.0.0.1:${standIn.address().port}`;

  user = (await sql`
    insert into users (clerk_id, email, display_name) values ('local-migration', 'migration@local.test', 'Migration check (local only)')
    on conflict (clerk_id) do update set email = excluded.email returning id`)[0].id;
  const inContent = newId("m");
  const inDoc = newId("m");
  const noteA = randomUUID();
  const noteB = randomUUID();
  const contentA = `Words before.\n\n![](attachment:${inContent})\n\nWords after.`;
  const docB = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Only the doc names it." }] }, { type: "image", attrs: { src: `attachment:${inDoc}` } }] };
  // Straight into the table, as rows written by code without the hook (or before 017) would be.
  await sql`insert into notes (id, user_id, title, content) values (${noteA}, ${user}, 'Migration check A', ${contentA})`;
  await sql`insert into notes (id, user_id, title, content, doc) values (${noteB}, ${user}, 'Migration check B', 'Only the doc names it.', ${sql.json(docB)})`;
  const linksOf = async () => (await sql`select note_id, attachment_id from note_attachments where user_id = ${user} order by 2`).map((r) => `${r.note_id}:${r.attachment_id}`);

  section("--check");
  let r = await apply017("--check");
  ok("--check: exit 0, changes nothing", r.status === 0 && r.before?.tables?.length === 4 && r.after === null, r.text.slice(0, 300));
  ok("…counts the notes naming photos", r.before?.notesNamingPhotos >= 2 && r.before?.namedPairs >= 2, JSON.stringify(r.before));
  ok("…and no links for them yet", (await linksOf()).length === 0);

  section("apply on an applied database");
  r = await apply017();
  ok("apply again: exit 0, 'safe to run twice'", r.status === 0 && /017 applied/.test(r.text), r.text.slice(0, 300));
  ok("…the backfill linked both notes (content and doc)", JSON.stringify(await linksOf()) === JSON.stringify([`${noteA}:${inContent}`, `${noteB}:${inDoc}`].sort((a, b) => a.split(":")[1].localeCompare(b.split(":")[1]))), JSON.stringify(await linksOf()));
  ok("…every named pair is linked", r.after?.links === r.after?.namedPairs, JSON.stringify(r.after));

  section("--rollback refusals");
  await sql`insert into attachments (user_id, id, content_type, bytes, storage_key, status, confirmed_at) values (${user}, ${inContent}, 'image/jpeg', 10, ${`u/${user}/${inContent}/x`}, 'ready', now())`;
  r = await apply017("--rollback", "--server", STAND_IN);
  ok("photo rows present: refuses, exit 1", r.status === 1 && /refusing: attachments has 1 rows/.test(r.text), r.text.slice(0, 300));
  ok("…the tables are still there", (await tables()).length === 4);
  await sql`delete from attachments where user_id = ${user}`;
  r = await apply017("--rollback", "--server", SERVER);
  ok("the photo code is live (local server answers 401): refuses, exit 1", r.status === 1 && /answers 401/.test(r.text), r.text.slice(0, 300));
  ok("…the tables are still there", (await tables()).length === 4);

  section("--rollback");
  r = await apply017("--rollback", "--server", STAND_IN);
  ok("the server answers 404: rolled back, exit 0", r.status === 0 && /017 rolled back/.test(r.text), r.text.slice(0, 300));
  ok("…the four tables are gone", (await tables()).length === 0);
  const notesAfter = await sql`select id, content, doc from notes where user_id = ${user} order by title`;
  ok("…the notes and their words are untouched", notesAfter.length === 2 && notesAfter[0].content === contentA && isDeepStrictEqual(notesAfter[1].doc, docB));

  section("re-apply");
  r = await apply017();
  ok("apply: exit 0, four tables", r.status === 0 && r.after?.tables?.length === 4, r.text.slice(0, 300));
  ok("…the links are rebuilt from content and doc", (await linksOf()).length === 2 && r.after?.links === r.after?.namedPairs, JSON.stringify(await linksOf()));
  r = await apply017("--check");
  ok("--check afterwards: exit 0", r.status === 0 && r.before?.tables?.length === 4);
  const usage = await fetch(`${SERVER}/_api/attachments/usage`).then((x) => x.status);
  ok("the local server still answers (401 signed out)", usage === 401, String(usage));
} catch (error) {
  ok("the run reached its checks", false, String(error?.message ?? error).split("\n")[0]);
} finally {
  standIn.close();
  try {
    if ((await tables()).length < 4) {
      console.log("the tables were left dropped: re-applying");
      await apply017();
    }
    if (user) await sql`delete from users where id = ${user}`; // cascades to its notes and links
  } catch (error) {
    console.log(`clean-up: ${error?.message ?? error}`);
  }
  await sql.end();
}
console.log(results.failed ? `\nmigration-check: ${results.failed} FAILED, ${results.passed} passed` : `\nmigration-check: all ${results.passed} passed`);
process.exit(results.failed ? 1 : 0);
