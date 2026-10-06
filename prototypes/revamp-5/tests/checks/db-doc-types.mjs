// Read-only: how each note's rich text is stored (an object, a string, or none), counted. No words are read.
import postgres from "/root/projects/clarity/node_modules/postgres/src/index.js";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, prepare: false });
try {
  const rows = await sql`select coalesce(jsonb_typeof(doc), 'none') as kind, count(*)::int as n, max(updated_at) as last from notes group by 1 order by 1`;
  console.log(JSON.stringify(rows));
} finally {
  await sql.end();
}
