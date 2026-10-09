// Proves the local stack is up and wired (docs/photos-server.md, 11.1):
// the database with every migration, the S3 enforcing signed size and type
// and answering CORS for :8095, the real server on :3410, the web proxy on
// :8095. Writes only a throwaway object to the local bucket (removed after).
//
//   node smoke.mjs               without signing in
//   node smoke.mjs --signed-in   also signs in as the test account and asks /_api/attachments/usage
import { sql, ok, results, section, callHelper, headKey, s3, Bucket, SERVER, APP, PORTS, photoBytes, signIn } from "./lib.mjs";
import { DeleteObjectsCommand } from "@aws-sdk/client-s3";

const signedIn = process.argv.includes("--signed-in");
try {
  section("database (PGlite on :5440)");
  const [one] = await sql`select 1 as one`;
  ok("answers a query", one?.one === 1);
  const migrations = await sql`select name, skipped from _local_migrations order by name`;
  ok("migrations 001-017 recorded (003 skipped: 001 has its constraints)", migrations.length === 17 && migrations.at(-1)?.name === "017_attachments.sql", `${migrations.length} rows`);
  const tables = await sql`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name in ('attachments', 'note_attachments', 'storage_deletions', 'maintenance_leases')`;
  ok("017's four tables exist", tables[0].n === 4);

  section("S3 (versitygw on :9400) through the server's own helpers/bucket.tsx");
  const key = `smoke/${Date.now()}`;
  const body = photoBytes(1234);
  let upload;
  try {
    upload = callHelper("helpers/bucket.tsx", "presignUpload", ["$bucket", key, body.length, "image/jpeg"]);
  } catch (error) {
    ok("presignUpload signs a link", false, error.message);
  }
  if (upload) {
    const signed = new URL(upload.url).searchParams.get("X-Amz-SignedHeaders") ?? "";
    ok("the upload link signs content-length and content-type", signed.includes("content-length") && signed.includes("content-type"), signed);
    const put = (b, type = "image/jpeg") => fetch(upload.url, { method: "PUT", headers: { "Content-Type": type }, body: b }).then((r) => r.status);
    ok("a PUT one byte longer is refused (403)", (await put(Buffer.concat([body, Buffer.from([1])]))) === 403);
    ok("a PUT as text/html is refused (403)", (await put(body, "text/html")) === 403);
    ok("the right PUT lands (200)", (await put(body)) === 200);
    const head = await headKey(key);
    ok("the object has the signed size and type", head?.bytes === body.length && head?.contentType === "image/jpeg", JSON.stringify(head));
    const pre = await fetch(upload.url, { method: "OPTIONS", headers: { Origin: `http://localhost:${PORTS.proxy}`, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" } });
    ok("CORS preflight from :8095 is allowed", pre.headers.get("access-control-allow-origin") === `http://localhost:${PORTS.proxy}`, `${pre.status} ${pre.headers.get("access-control-allow-origin")}`);
    await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: [{ Key: key }], Quiet: true } }));
  }

  section("server (server.ts on :3410)");
  const usage = await fetch(`${SERVER}/_api/attachments/usage`);
  ok("GET /_api/attachments/usage signed out: 401 (the route exists)", usage.status === 401, `status ${usage.status}`);
  const list = await fetch(`${SERVER}/_api/notes/list`);
  ok("GET /_api/notes/list signed out: 401", list.status === 401, `status ${list.status}`);

  section("web proxy (:8095)");
  try {
    const page = await fetch(`${APP}/`);
    ok("Sage's web build is served", page.status === 200 && (await page.text()).includes("__SAGE_API_BASE__"), `status ${page.status}`);
    const viaProxy = await fetch(`${APP}/_api/attachments/usage`);
    ok("/_api goes to the local server", viaProxy.status === 401, `status ${viaProxy.status}`);
  } catch (error) {
    ok("the web proxy answers (./stack.sh proxy)", false, error.message);
  }

  if (signedIn) {
    section("signed in as the test account");
    const session = await signIn();
    try {
      const u = await session.api("GET", "/_api/attachments/usage");
      ok("usage: 200, enabled", u.status === 200 && u.data?.enabled === true, `${u.status} ${u.text.slice(0, 200)}`);
      const [me] = await sql`select id from users where email = ${session.email}`;
      ok("the local server made the test account's users row", !!me);
    } finally {
      await session.close();
    }
  }
} catch (error) {
  ok("smoke ran to the end", false, error.message);
} finally {
  await sql.end();
  console.log(results.failed ? `\n${results.failed} FAILED, ${results.passed} passed` : `\nall ${results.passed} passed`);
  process.exit(results.failed ? 1 : 0);
}
