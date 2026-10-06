// Applies migration 014 to the database in DATABASE_URL (run via `railway run`), then reads back what it made.
// node apply-014.mjs [--check]   --check only reports the current state and changes nothing.
import { readFileSync } from "node:fs";
import postgres from "/root/projects/clarity/node_modules/postgres/src/index.js";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, prepare: false, onnotice: () => {} });
const state = async () => {
  const cols = await sql`select column_name from information_schema.columns where table_name = 'tasks' and column_name in ('completed_at', 'moved_from') order by 1`;
  const [table] = await sql`select to_regclass('public.task_suggestions')::text as name`;
  const [check] = await sql`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'notes_source_check'`;
  return { taskColumns: cols.map((c) => c.column_name), suggestionsTable: table.name, sourceCheck: check?.def };
};
try {
  console.log("before:", JSON.stringify(await state()));
  if (!process.argv.includes("--check")) {
    await sql.unsafe(readFileSync("/root/projects/clarity-revamp-5-branch/migrations/014_task_times_pages_suggestions.sql", "utf8"));
    console.log("after: ", JSON.stringify(await state()));
  }
} finally {
  await sql.end();
}
