// Applies the repo's migrations, in order, to the LOCAL database
// (docs/photos-server.md, 11.1), over one connection, and records each one in
// a table of its own (_local_migrations) so running it again only applies what
// is new. Refuses any database that isn't on localhost.
//
//   node migrate.mjs                 DATABASE_URL (postgres://postgres@localhost:5440/postgres)
//
// 003 is skipped on a fresh database: 001 already creates its two
// constraints, so 003 fails there ("already exists"). It is tried in a
// savepoint and skipped only for that reason.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL || "postgres://postgres@localhost:5440/postgres";
if (!/^postgres(ql)?:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\//.test(url)) {
  console.error("migrate.mjs only runs against a local database (localhost).");
  process.exit(2);
}
const dir = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");
const files = readdirSync(dir).filter((name) => /^\d{3}_.*\.sql$/.test(name)).sort();

const sql = postgres(url, { max: 1, prepare: false, ssl: false, onnotice: () => {} });
try {
  await sql`create table if not exists _local_migrations (name text primary key, applied_at timestamptz not null default now(), skipped boolean not null default false)`;
  const done = new Set((await sql`select name from _local_migrations`).map((row) => row.name));
  for (const name of files) {
    if (done.has(name)) continue;
    const text = readFileSync(join(dir, name), "utf8");
    if (name.startsWith("003_")) {
      // Its constraints come with 001 on a fresh database.
      const have = await sql`select count(*)::int as n from pg_constraint where conname in ('projects_user_normalized_name_key', 'tasks_user_note_fingerprint_key')`;
      if (have[0].n === 2) {
        await sql`insert into _local_migrations (name, skipped) values (${name}, true)`;
        console.log(`skip  ${name} (001 already made its constraints)`);
        continue;
      }
    }
    // Simple protocol (no parameters), so a file with several statements and
    // its own BEGIN/COMMIT runs as written.
    await sql.unsafe(text);
    await sql`insert into _local_migrations (name) values (${name})`;
    console.log(`apply ${name}`);
  }
  const tables = await sql`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('attachments', 'note_attachments', 'storage_deletions', 'maintenance_leases') order by 1`;
  console.log(`photo tables: ${tables.map((t) => t.table_name).join(", ") || "none"}`);
} finally {
  await sql.end();
}
