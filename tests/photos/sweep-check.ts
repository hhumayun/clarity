// The clean-up checks for photos (docs/photos-server.md, 11.2 checks 16, 17
// and 24), against the local database (PGlite, :5440) and the local bucket
// (versitygw, :9400). No sign-in: every user here is a throwaway row made in
// the local database. The sweep, account deletion and the rebuild script run
// through call.ts / tsx in their own processes, each with exactly the
// variables its case needs (ATTACHMENT_SWEEP_BUDGET_MS,
// ATTACHMENT_RECONCILE_MIN_AGE_MS, the bucket on or off).
//
//   tsx tests/photos/sweep-check.ts        (from the worktree root; api-check.mjs runs it too)
//
// Stops and restarts the local S3 once (stack.sh s3-stop / s3-start).
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postgres from "postgres";
import {
  S3Client, PutObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectsCommand, DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const NODE = "/opt/node24/bin/node";
const LOCAL = {
  DATABASE_URL: `postgres://postgres@localhost:${process.env.CHECK_PG_PORT || 5440}/postgres`,
  PHOTOS_BUCKET: process.env.CHECK_BUCKET || "clarity-photos-local",
  PHOTOS_ACCESS_KEY_ID: "labkey",
  PHOTOS_SECRET_ACCESS_KEY: "labsecret123",
  PHOTOS_ENDPOINT: "http://127.0.0.1:9400",
  PHOTOS_REGION: "auto",
  PHOTOS_PATH_STYLE: "1",
};
const Bucket = LOCAL.PHOTOS_BUCKET;

const sql = postgres(LOCAL.DATABASE_URL, { max: 1, prepare: false, ssl: false, onnotice: () => {} });
const s3 = new S3Client({
  region: "auto", endpoint: LOCAL.PHOTOS_ENDPOINT, forcePathStyle: true, maxAttempts: 1,
  credentials: { accessKeyId: LOCAL.PHOTOS_ACCESS_KEY_ID, secretAccessKey: LOCAL.PHOTOS_SECRET_ACCESS_KEY },
});

let passed = 0;
let failed = 0;
function ok(name: string, pass: boolean, detail = "") {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${!pass && detail ? `  (${detail})` : ""}`);
}
async function group(title: string, fn: () => Promise<void>) {
  console.log(`\n== ${title}`);
  try {
    await fn();
  } catch (error) {
    ok(`${title}: ran to the end`, false, String(error instanceof Error ? error.message : error).split("\n")[0]);
  }
}

// --- helpers ---------------------------------------------------------------------

function call(modulePath: string, exportName: string, args: unknown[] = [], extraEnv: Record<string, string> = {}, photos = true): unknown {
  const env: Record<string, string> = {
    PATH: "/opt/node24/bin:/usr/bin:/bin", HOME: process.env.HOME ?? "/root",
    ...(photos ? LOCAL : { DATABASE_URL: LOCAL.DATABASE_URL }), ATTACHMENT_SWEEP_EVERY_MS: "0", ...extraEnv,
  };
  const out = spawnSync(NODE, [join(ROOT, "node_modules/.bin/tsx"), join(HERE, "call.ts"), modulePath, exportName, JSON.stringify(args)], { cwd: ROOT, env: env as NodeJS.ProcessEnv, encoding: "utf8", timeout: 180_000 });
  const line = (out.stdout || "").split("\n").reverse().find((l) => l.startsWith("RESULT "));
  if (!line) throw new Error(`${exportName}: ${(out.stderr || out.stdout || "no output").trim().split("\n").slice(-3).join(" | ")}`);
  return JSON.parse(line.slice("RESULT ".length));
}
/** One sweep run, the lease freed first (a crashed run would otherwise hold it 10 minutes). */
async function sweep(opts: { daily?: boolean } = {}, extraEnv: Record<string, string> = {}, photos = true) {
  await sql`delete from maintenance_leases where name = 'attachment-sweep'`;
  return call("helpers/attachmentSweep.tsx", "sweepAttachments", [opts], extraEnv, photos);
}
function stack(command: string) {
  const out = spawnSync(join(HERE, "stack.sh"), [command], { encoding: "utf8", timeout: 120_000 });
  if (out.status !== 0) throw new Error(`stack.sh ${command}: ${(out.stdout + out.stderr).trim()}`);
}

async function head(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
    return true;
  } catch (error) {
    const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.$metadata?.httpStatusCode === 404 || e.name === "NotFound") return false;
    throw error;
  }
}
async function list(prefix: string): Promise<string[]> {
  const out = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix }));
  return (out.Contents ?? []).map((o) => o.Key ?? "");
}
const put = (key: string) => s3.send(new PutObjectCommand({ Bucket, Key: key, Body: Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]), ContentType: "image/jpeg" }));
async function emptyPrefix(prefix: string) {
  const keys = await list(prefix);
  if (keys.length) await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }));
}

let seq = 0;
const newId = (tag: string) => `${tag}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

async function newUser(tag: string): Promise<number> {
  const [row] = await sql`insert into users (clerk_id, email, display_name) values (${`local-${tag}-${Date.now()}-${seq++}`}, ${`${tag}@local.test`}, ${`Throwaway ${tag}`}) returning id`;
  return row.id as number;
}
/** A photo row (and its object) as it would be after start/confirm; times moved by the arguments. */
async function photo(userId: number, opts: { status?: "pending" | "ready"; startedHoursAgo?: number; orphanedDaysAgo?: number | null; object?: boolean } = {}) {
  const id = newId("sw");
  const key = `u/${userId}/${id}/k${seq++}`;
  const status = opts.status ?? "ready";
  await sql`
    insert into attachments (user_id, id, content_type, bytes, storage_key, status, upload_started_at, confirmed_at, orphaned_since)
    values (${userId}, ${id}, 'image/jpeg', 6, ${key}, ${status},
      now() - make_interval(hours => ${opts.startedHoursAgo ?? 0}),
      ${status === "ready" ? sql`now()` : null},
      ${opts.orphanedDaysAgo == null ? null : sql`now() - make_interval(days => ${opts.orphanedDaysAgo})`})`;
  if (opts.object !== false) await put(key);
  return { id, key };
}
async function note(userId: number, content: string, linkIds: string[] = []) {
  const [row] = await sql`insert into notes (user_id, title, content) values (${userId}, 'Sweep check', ${content}) returning id`;
  for (const a of linkIds) await sql`insert into note_attachments (note_id, user_id, attachment_id) values (${row.id}, ${userId}, ${a})`;
  return row.id as string;
}
const rowOf = async (userId: number, id: string) => (await sql`select * from attachments where user_id = ${userId} and id = ${id}`)[0];
const queuedRow = async (key: string) => (await sql`select * from storage_deletions where storage_key = ${key}`)[0];
const due = (key: string) => sql`update storage_deletions set not_before = now() - interval '1 minute' where storage_key = ${key}`;

// --- the run -------------------------------------------------------------------------

const users: number[] = [];
try {
  await group("16. the sweep", async () => {
    const u = await newUser("sweep");
    users.push(u);

    const expired = await photo(u, { status: "pending", startedHoursAgo: 25 });
    const fresh = await photo(u, { status: "pending", startedHoursAgo: 23 });
    const old = await photo(u, { orphanedDaysAgo: 8 });
    const young = await photo(u, { orphanedDaysAgo: 6 });
    const relinked = await photo(u, { orphanedDaysAgo: 8 });
    await note(u, `Named ![](attachment:${relinked.id})`, [relinked.id]);
    const textOnly = await photo(u, { orphanedDaysAgo: 8 });
    const textNote = await note(u, `Saved while the hook was off ![](attachment:${textOnly.id})`);
    const docOnly = await photo(u, { orphanedDaysAgo: 8 });
    const [docNote] = await sql`insert into notes (user_id, title, content, doc) values (${u}, 'Sweep check', 'words', ${sql.json({ type: "doc", content: [{ type: "image", attrs: { src: `attachment:${docOnly.id}` } }] })}) returning id`;

    await sweep();
    ok("a pending upload 25 h old: row gone", !(await rowOf(u, expired.id)));
    ok("…its key queued, not yet due, object still there", !!(await queuedRow(expired.key)) && (await head(expired.key)));
    ok("a pending upload 23 h old: kept", !!(await rowOf(u, fresh.id)));
    ok("an orphan 8 days old: row gone, key queued", !(await rowOf(u, old.id)) && !!(await queuedRow(old.key)));
    ok("an orphan 6 days old: kept", !!(await rowOf(u, young.id)));
    ok("an orphan 8 days old that a note names again (a link): kept", !!(await rowOf(u, relinked.id)));
    const t = await rowOf(u, textOnly.id);
    ok("an orphan 8 days old with no link but named in a note's content: kept", !!t);
    ok("…its mark cleared", t?.orphaned_since === null);
    const rebuilt = await sql`select 1 from note_attachments where note_id = ${textNote} and attachment_id = ${textOnly.id}`;
    ok("…and its link rebuilt", rebuilt.length === 1);
    ok("an orphan 8 days old named only in a note's doc: kept", !!(await rowOf(u, docOnly.id)) && (await sql`select 1 from note_attachments where note_id = ${docNote.id} and attachment_id = ${docOnly.id}`).length === 1);

    await due(expired.key);
    await due(old.key);
    await sweep();
    ok("after not_before: the drain deletes the objects", !(await head(expired.key)) && !(await head(old.key)));
    ok("…and their queue rows", !(await queuedRow(expired.key)) && !(await queuedRow(old.key)));

    // A key queued while the bucket is stopped.
    const k = `u/${u}/down-${Date.now()}/k`;
    await put(k);
    await sql`insert into storage_deletions (storage_key, not_before) values (${k}, now() - interval '1 minute')`;
    const notDue = `u/${u}/later-${Date.now()}/k`;
    await put(notDue);
    await sql`insert into storage_deletions (storage_key) values (${notDue})`;
    stack("s3-stop");
    try {
      await sweep({}, { ATTACHMENT_SWEEP_BUDGET_MS: "30000" });
      const q = await queuedRow(k);
      ok("bucket stopped: the queued key's attempts go to 1, row kept", q?.attempts === 1 && !!q.last_error, JSON.stringify(q));
    } finally {
      stack("s3-start");
    }
    await sweep();
    ok("bucket back: gone", !(await queuedRow(k)) && !(await head(k)));
    ok("a key not yet due: kept, object there", !!(await queuedRow(notDue)) && (await head(notDue)));

    // Daily pass: mark, then reconcile. The bucket starts with no owner file
    // (as a new bucket would), so this database claims it.
    await s3.send(new DeleteObjectCommand({ Bucket, Key: "meta/owner" }));
    const unmarked = await photo(u, { orphanedDaysAgo: null });
    const stray = `u/${u}/stray-${Date.now()}/k`;
    await put(stray);
    const claimed = (await sweep({ daily: true }, { ATTACHMENT_RECONCILE_MIN_AGE_MS: "0" })) as { reconcileRefused?: string };
    ok("daily: a ready photo with no link gets marked", !!(await rowOf(u, unmarked.id))?.orphaned_since);
    ok("daily: a bucket with no owner file is claimed (meta/owner written)", (await head("meta/owner")) && !claimed.reconcileRefused, JSON.stringify(claimed));
    ok("daily: an object with no row and no queue row is queued", !!(await queuedRow(stray)));
    ok("…but a key that has a row is not", !(await queuedRow(unmarked.key)) && !(await queuedRow(young.key)));
    await due(stray);
    await sweep();
    ok("…and then deleted", !(await head(stray)) && !(await queuedRow(stray)));

    // A bucket another database owns: nothing is queued.
    const foreign = `u/${u}/foreign-${Date.now()}/k`;
    await put(foreign);
    const ownerFile = await s3.send(new (await import("@aws-sdk/client-s3")).GetObjectCommand({ Bucket, Key: "meta/owner" }));
    const ownerText = (await ownerFile.Body?.transformToString()) ?? "";
    await s3.send(new PutObjectCommand({ Bucket, Key: "meta/owner", Body: JSON.stringify({ owner: "another-database", db: "elsewhere" }) }));
    const refused = (await sweep({ daily: true }, { ATTACHMENT_RECONCILE_MIN_AGE_MS: "0" })) as { reconcileRefused?: string };
    ok("daily: meta/owner naming another database: reconcile refused, nothing queued", refused.reconcileRefused === "owner" && !(await queuedRow(foreign)), JSON.stringify(refused));
    await s3.send(new PutObjectCommand({ Bucket, Key: "meta/owner", Body: ownerText }));

    // More strays than the valve allows: nothing is queued.
    const valve = (await sweep({ daily: true }, { ATTACHMENT_RECONCILE_MIN_AGE_MS: "0", ATTACHMENT_RECONCILE_MAX_STRAYS: "0" })) as { reconcileRefused?: string };
    ok("daily: more strays than allowed: reconcile refused, nothing queued", valve.reconcileRefused === "strays" && !(await queuedRow(foreign)), JSON.stringify(valve));
    const back = (await sweep({ daily: true }, { ATTACHMENT_RECONCILE_MIN_AGE_MS: "0" })) as { reconcileRefused?: string };
    ok("…its own owner file back and within the limit: queued", !back.reconcileRefused && !!(await queuedRow(foreign)), JSON.stringify(back));

    // Budget 0: does nothing, frees the lease.
    const waiting = await photo(u, { status: "pending", startedHoursAgo: 30 });
    await sweep({}, { ATTACHMENT_SWEEP_BUDGET_MS: "0" });
    ok("a run with the budget at 0 does nothing", !!(await rowOf(u, waiting.id)));
    const [lease] = await sql`select held_until <= now() as free from maintenance_leases where name = 'attachment-sweep'`;
    ok("…and releases the lease", lease?.free === true, JSON.stringify(lease));

    // Photos off: queues, doesn't drain.
    const offKey = `u/${u}/off-${Date.now()}/k`;
    await put(offKey);
    await sql`insert into storage_deletions (storage_key, not_before) values (${offKey}, now() - interval '1 minute')`;
    const offPending = await photo(u, { status: "pending", startedHoursAgo: 26 });
    await sweep({}, {}, false);
    ok("photos off: expired rows still go to the queue", !(await rowOf(u, offPending.id)) && !!(await queuedRow(offPending.key)));
    ok("…but nothing is drained", !!(await queuedRow(offKey)) && (await head(offKey)));
  });

  await group("17. account deletion (deleteAccountData, a throwaway local user)", async () => {
    const u = await newUser("gone");
    users.push(u); // removed by deleteAccountData; cleaned up below if it wasn't
    const a = await photo(u, {});
    const b = await photo(u, { status: "pending" });
    await note(u, `![](attachment:${a.id})`, [a.id]);
    const loose = `u/${u}/loose/k`;
    await put(loose);
    call("helpers/accountDeletion.tsx", "deleteAccountData", [u]);
    const left = await sql`
      select (select count(*) from attachments where user_id = ${u})::int as a,
             (select count(*) from note_attachments where user_id = ${u})::int as l,
             (select count(*) from notes where user_id = ${u})::int as n,
             (select count(*) from users where id = ${u})::int as u`;
    ok("no rows left for the user", left[0].a + left[0].l + left[0].n + left[0].u === 0, JSON.stringify(left[0]));
    ok("nothing under u/<id>/, including an object with no row", (await list(`u/${u}/`)).length === 0);
    const prefix = await queuedRow(`u/${u}/`);
    ok("a prefix row in storage_deletions", prefix?.is_prefix === true);
    ok("…and the photos' keys queued", !!(await queuedRow(a.key)) && !!(await queuedRow(b.key)));
    // A PUT landing after the listing, through a link signed before the deletion.
    await put(`u/${u}/late/k`);
    await sql`update storage_deletions set not_before = now() - interval '1 minute' where storage_key like ${`u/${u}/%`}`;
    await sweep();
    ok("after not_before and a sweep: nothing under the prefix", (await list(`u/${u}/`)).length === 0);
    ok("…the prefix row gone", !(await queuedRow(`u/${u}/`)));
  });

  await group("24. the rebuild script", async () => {
    const refs = (await import(pathToFileURL(join(ROOT, "helpers/attachmentRefs.tsx")).href)) as {
      attachmentIdsOf: (content: string, doc: unknown) => Set<string>;
    };
    const u = await newUser("rebuild");
    users.push(u);
    const p1 = newId("rb");
    const p2 = newId("rb");
    await note(u, `one ![](attachment:${p1}) and a broken attachment:${p2}`);
    await sql`insert into notes (user_id, title, content, doc) values (${u}, 'Sweep check', 'doc only', ${sql.json({ type: "doc", content: [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "image", attrs: { src: `attachment:${p1}` } }] }] }] })})`;
    await sql`delete from note_attachments`;
    const out = spawnSync(NODE, [join(ROOT, "node_modules/.bin/tsx"), join(ROOT, "scripts/rebuild-note-attachments.ts")], {
      cwd: ROOT, env: { PATH: "/opt/node24/bin:/usr/bin:/bin", HOME: process.env.HOME ?? "/root", DATABASE_URL: LOCAL.DATABASE_URL } as unknown as NodeJS.ProcessEnv, encoding: "utf8", timeout: 180_000,
    });
    ok("the script runs", out.status === 0, (out.stderr || out.stdout).trim().split("\n").slice(-2).join(" | "));
    const notes = await sql`select id, user_id, content, doc from notes`;
    const want = new Set<string>();
    for (const n of notes) for (const id of refs.attachmentIdsOf(n.content as string, n.doc)) want.add(`${n.id}|${id}`);
    const have = new Set((await sql`select note_id, attachment_id from note_attachments`).map((r) => `${r.note_id}|${r.attachment_id}`));
    const same = want.size === have.size && [...want].every((k) => have.has(k));
    ok("the links match attachmentIdsOf over every note's content and doc", same, `want ${want.size}, have ${have.size}`);
  });
} finally {
  for (const u of users) {
    await sql`delete from storage_deletions where storage_key like ${`u/${u}/%`}`.catch(() => {});
    await sql`delete from note_attachments where user_id = ${u}`.catch(() => {});
    await sql`delete from attachments where user_id = ${u}`.catch(() => {});
    await sql`delete from users where id = ${u}`.catch(() => {});
    await emptyPrefix(`u/${u}/`).catch(() => {});
  }
  await sql.end();
  console.log(failed ? `\nsweep-check: ${failed} FAILED, ${passed} passed` : `\nsweep-check: all ${passed} passed`);
  process.exit(failed ? 1 : 0);
}
