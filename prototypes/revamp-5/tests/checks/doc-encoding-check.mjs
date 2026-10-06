// How the server's way of writing rich text lands in a jsonb column, on a temporary
// table that only lives for this connection: the current write, and the fixed one.
import { Kysely, sql } from "/root/projects/clarity/node_modules/kysely/dist/esm/index.js";
import { PostgresJSDialect } from "/root/projects/clarity/node_modules/kysely-postgres-js/dist/index.js";
import postgres from "/root/projects/clarity/node_modules/postgres/src/index.js";
const db = new Kysely({ dialect: new PostgresJSDialect({ postgres: postgres(process.env.DATABASE_URL, { prepare: false, max: 1, ssl: "require" }) }) });
const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] };
try {
  await db.connection().execute(async (conn) => {
    await sql`create temporary table doc_check (way text, doc jsonb)`.execute(conn);
    await sql`insert into doc_check values ('now', ${sql`${JSON.stringify(doc)}::jsonb`})`.execute(conn);
    await sql`insert into doc_check values ('fixed', ${sql`${JSON.stringify(doc)}::text::jsonb`})`.execute(conn);
    const rows = await sql`select way, jsonb_typeof(doc) as kind, doc #>> '{type}' as type from doc_check`.execute(conn);
    console.log(JSON.stringify(rows.rows));
    const unwrapped = await sql`select jsonb_typeof((doc #>> '{}')::jsonb) as kind from doc_check where way = 'now'`.execute(conn);
    console.log("the migration's unwrap gives:", JSON.stringify(unwrapped.rows));
  });
} finally {
  await db.destroy();
}
