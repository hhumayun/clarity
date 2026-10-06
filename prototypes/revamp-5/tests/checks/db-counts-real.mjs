// Read-only: the real accounts' rows (everything but the +clerk_test account), to show a deploy or test left them alone.
import postgres from "/root/projects/clarity/node_modules/postgres/src/index.js";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, prepare: false });
try {
  const [r] = await sql`
    with real as (select id from users where email not like '%+clerk_test@%')
    select
      (select count(*)::int from notes where user_id in (select id from real)) as notes,
      (select count(*)::int from tasks where user_id in (select id from real)) as tasks,
      (select count(*)::int from tasks where user_id in (select id from real) and status = 'done') as done,
      (select count(*)::int from projects where user_id in (select id from real)) as projects,
      (select count(*)::int from task_suggestions where user_id in (select id from real)) as suggestions,
      (select max(updated_at) from notes where user_id in (select id from real)) as notes_last,
      (select max(updated_at) from tasks where user_id in (select id from real)) as tasks_last`;
  console.log(JSON.stringify(r));
} finally {
  await sql.end();
}
