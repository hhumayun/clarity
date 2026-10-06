// Migrations 016 (tasks.remind_once) and 015 (rich text unwrapped), on the database in DATABASE_URL
// (run via `railway run`). One step per run:
//   --check    report the state, change nothing
//   --backup   write the twice-encoded notes' rich text (id, doc, updated_at) to an owner-only file
//   --016      apply migration 016 and read back what it made
//   --015      apply migration 015 and confirm only the doc column changed
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import postgres from "/root/projects/clarity/node_modules/postgres/src/index.js";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, prepare: false, onnotice: () => {} });
const MIGRATIONS = "/root/projects/clarity-revamp-5-branch/migrations";
const BACKUP = "/root/.config/clarity-backups/2026-10-06-before-015-note-docs.json";

const state = async () => {
  const [column] = await sql`select data_type, is_nullable, column_default from information_schema.columns where table_name = 'tasks' and column_name = 'remind_once'`;
  const kinds = await sql`select coalesce(jsonb_typeof(doc), 'none') as kind, count(*)::int as n from notes group by 1 order by 1`;
  const counts = {};
  for (const table of ["notes", "tasks", "projects", "users"]) counts[table] = (await sql.unsafe(`select count(*)::int as n from ${table}`))[0].n;
  const triggers = await sql`select tgrelid::regclass::text as on_table, tgname from pg_trigger where not tgisinternal and tgrelid in ('notes'::regclass, 'tasks'::regclass)`;
  const [times] = await sql`select max(updated_at) as notes_last, (select max(updated_at) from tasks) as tasks_last from notes`;
  return { remindOnce: column ?? null, docKinds: kinds, counts, triggers, ...times };
};
// The twice-encoded notes, as stored, with their last-changed times.
const stringDocs = () => sql`select id, doc, updated_at from notes where jsonb_typeof(doc) = 'string' order by id`;

try {
  const step = process.argv[2] ?? "--check";
  const before = await state();
  console.log("before:", JSON.stringify(before));
  if (step === "--backup") {
    const rows = await stringDocs();
    mkdirSync("/root/.config/clarity-backups", { recursive: true });
    writeFileSync(BACKUP, JSON.stringify(rows.map((row) => ({ id: row.id, doc: row.doc, updatedAt: row.updated_at })), null, 1));
    chmodSync(BACKUP, 0o600);
    console.log(`backed up ${rows.length} notes' rich text to ${BACKUP}`);
  } else if (step === "--016") {
    await sql.unsafe(readFileSync(`${MIGRATIONS}/016_task_remind_once.sql`, "utf8"));
    const after = await state();
    console.log("after: ", JSON.stringify(after));
    const [set] = await sql`select count(*)::int as n from tasks where remind_once`;
    console.log(`tasks marked remind_once: ${set.n} (should be 0); task count ${before.counts.tasks} -> ${after.counts.tasks}; tasks last changed ${before.tasks_last?.toISOString()} -> ${after.tasks_last?.toISOString()}`);
  } else if (step === "--015") {
    const rows = await stringDocs();
    const times = new Map(rows.map((row) => [row.id, row.updated_at.toISOString()]));
    await sql.unsafe(readFileSync(`${MIGRATIONS}/015_note_doc_objects.sql`, "utf8"));
    const after = await state();
    console.log("after: ", JSON.stringify(after));
    const now = await sql`select id, jsonb_typeof(doc) as kind, doc #>> '{type}' as type, updated_at from notes where id in ${sql([...times.keys()])}`;
    const objects = now.filter((row) => row.kind === "object" && row.type === "doc").length;
    const moved = now.filter((row) => row.updated_at.toISOString() !== times.get(row.id)).length;
    console.log(`unwrapped: ${objects} of ${rows.length} now documents; last-changed times moved: ${moved} (should be 0); note count ${before.counts.notes} -> ${after.counts.notes}`);
  }
} finally {
  await sql.end();
}
