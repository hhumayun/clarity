// Read-only: every row belonging to the real accounts (all but +clerk_test ones), to a private JSON file.
// Prints counts only, never content.
import { writeFileSync } from "node:fs";
import postgres from "/root/projects/clarity/node_modules/postgres/src/index.js";
const out = process.argv[2];
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, prepare: false });
try {
  const real = (await sql`select id from users where email not like '%+clerk_test@%'`).map((r) => r.id);
  const tables = (await sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`).map((r) => r.table_name);
  const columns = await sql`select table_name, column_name from information_schema.columns where table_schema = 'public'`;
  const has = (table, column) => columns.some((c) => c.table_name === table && c.column_name === column);
  const backup = { takenAt: new Date().toISOString(), why: "before revamp 5 saves to real accounts", tables: {} };
  const counts = {};
  for (const table of tables) {
    let rows;
    if (table === "users") rows = await sql`select * from users where id = any(${real})`;
    else if (has(table, "user_id")) rows = await sql`select * from ${sql(table)} where user_id = any(${real})`;
    else if (has(table, "note_id")) rows = await sql`select * from ${sql(table)} where note_id in (select id from notes where user_id = any(${real}))`;
    else continue;
    backup.tables[table] = rows;
    counts[table] = rows.length;
  }
  writeFileSync(out, JSON.stringify(backup), { mode: 0o600 });
  console.log(JSON.stringify(counts));
} finally {
  await sql.end();
}
