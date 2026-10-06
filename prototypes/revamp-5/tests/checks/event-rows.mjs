// Read-only: the TEST account's suggestion events named "Sage check…" (event-check.mjs's), by text.
// Run through `railway run --service clarity-notes --environment production node <this>` from /root/projects/clarity.
import postgres from "/root/projects/clarity/node_modules/postgres/src/index.js";
const EMAIL = process.env.SAGE_TEST_EMAIL;
if (!EMAIL?.includes("+clerk_test@")) throw new Error("SAGE_TEST_EMAIL must be the +clerk_test address");
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, prepare: false });
try {
  const rows = await sql`
    select e.suggestion_text as text, e.action, count(*)::int as n
    from suggestion_events e join users u on u.id = e.user_id
    where u.email = ${EMAIL} and e.suggestion_text like 'Sage check%'
    group by 1, 2 order by 1`;
  console.log(JSON.stringify(rows));
} finally {
  await sql.end();
}
