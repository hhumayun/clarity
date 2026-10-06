// Read-only: row counts of the main tables, and the done tasks, so a migration can be shown to have kept every row.
import postgres from "/root/projects/clarity/node_modules/postgres/src/index.js";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, prepare: false });
try {
  const counts = {};
  for (const table of ["users", "notes", "tasks", "projects", "note_tasks", "note_projects", "task_extractions", "focus_sessions"]) {
    const [row] = await sql.unsafe(`select count(*)::int as n from ${table}`);
    counts[table] = row.n;
  }
  const [done] = await sql`select count(*)::int as n, max(updated_at) as last from tasks where status = 'done'`;
  const [latest] = await sql`select max(updated_at) as notes_last from notes`;
  console.log(JSON.stringify({ counts, doneTasks: done.n, doneLastChanged: done.last, notesLastChanged: latest.notes_last }));
} finally {
  await sql.end();
}
