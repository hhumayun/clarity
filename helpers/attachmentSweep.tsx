import { sql } from "kysely";
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";
import { bucket, deleteObjects, getText, listPage, putText, type Bucket } from "./bucket";
import { lastApiActivityAt } from "./apiActivity";

/**
 * The photo clean-up (docs/photos-server.md, section 7.1). One run:
 *   1. deletes uploads never confirmed within 24 hours,
 *   2. gives links back to marked photos a note's text still names,
 *   3. deletes photos marked more than 7 days ago that nothing names,
 *   4. lists and empties queued prefixes (deleted accounts),
 *   5. drains queued object deletions that are due,
 *   6. once a day, marks ready photos no link names and queues bucket
 *      objects nothing knows about (only in a bucket proven to be this
 *      database's, and never more than a small share of it at once).
 * Steps 1 and 3 only move keys into storage_deletions (in the statement that
 * removes the row); the bucket is touched only in steps 4-6, outside any
 * transaction. Only one instance runs at a time (a lease row), and a run stops
 * starting new batches when its time budget is spent. Backend only.
 */

const SWEEP_LEASE = "attachment-sweep";
const DAILY_LEASE = "attachment-daily";
const BATCH = 500;
const DRAIN_BATCH = 1000;
const MARK_BATCH = 1000;
const PREFIX_ROWS = 100;
const MAX_ATTEMPTS_QUIET = 20;
const FIRST_RUN_MS = 2 * 60 * 1000;
/** The bucket's owner: an id kept in this database and in the bucket at OWNER_KEY. */
const OWNER_LEASE = "bucket-owner";
const OWNER_KEY = "meta/owner";
/** Strays in one daily pass above which the reconcile queues nothing (a misconfigured run must not empty a bucket). */
const MAX_STRAYS = 500;
/** …or above this share of the keys listed, once there are more than MIN_STRAYS_FOR_SHARE. */
const MAX_STRAY_SHARE = 0.05;
const MIN_STRAYS_FOR_SHARE = 20;

export type SweepReport = {
  /** Why nothing ran: another run in this process, or another instance holds the lease. */
  skipped?: "running" | "leased";
  expired: number;
  repaired: number;
  orphans: number;
  prefixesEmptied: number;
  prefixesFailed: number;
  drained: number;
  drainFailed: number;
  daily: boolean;
  marked: number;
  unmarked: number;
  reconciled: number;
  /** Why the reconcile queued nothing: the bucket isn't proven this database's, or too many strays. */
  reconcileRefused?: "owner" | "strays";
  /** The budget ran out before every step finished. */
  outOfTime: boolean;
  /** The name of an error that ended the run early. */
  error?: string;
};

let running = false;

const numberFromEnv = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

/** An error's name (and a Postgres SQLSTATE), never its message: messages can carry hosts, keys or note text. */
function errorName(error: unknown): string {
  const e = error as { name?: unknown; code?: unknown } | null;
  const name = typeof e?.name === "string" ? e.name : "Error";
  const code = typeof e?.code === "string" && /^[0-9A-Z]{5}$/.test(e.code) ? ` ${e.code}` : "";
  return `${name}${code}`.slice(0, 100);
}

/** One bucket call: logged by name and status only on failure, never thrown. */
async function bucketTry<T>(what: string, call: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    const e = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
    const name = (e?.name ?? "Error").slice(0, 100);
    console.error(`sweep: bucket ${what} failed:`, name, e?.$metadata?.httpStatusCode ?? "-");
    return { ok: false, error: name };
  }
}

const count = (rows: { n?: unknown }[]) => Number(rows[0]?.n ?? 0);

/** Takes a lease row when it is free (held_until has passed). True when this holder has it. */
async function takeLease(name: string, holder: string, seconds: number, force = false): Promise<boolean> {
  const until = sql`now() + make_interval(secs => ${seconds}::int)`;
  const { rows } = force
    ? await sql<{ holder: string }>`
        insert into maintenance_leases (name, holder, held_until) values (${name}, ${holder}, ${until})
        on conflict (name) do update set holder = excluded.holder, held_until = excluded.held_until
        returning holder`.execute(db)
    : await sql<{ holder: string }>`
        insert into maintenance_leases (name, holder, held_until) values (${name}, ${holder}, ${until})
        on conflict (name) do update set holder = excluded.holder, held_until = excluded.held_until
        where maintenance_leases.held_until < now()
        returning holder`.execute(db);
  return rows[0]?.holder === holder;
}

/** One sweep run. Never throws: errors are logged by name and reported. */
export async function sweepAttachments(opts: { daily?: boolean } = {}): Promise<SweepReport> {
  const report: SweepReport = {
    expired: 0,
    repaired: 0,
    orphans: 0,
    prefixesEmptied: 0,
    prefixesFailed: 0,
    drained: 0,
    drainFailed: 0,
    daily: false,
    marked: 0,
    unmarked: 0,
    reconciled: 0,
    outOfTime: false,
  };
  if (running) return { ...report, skipped: "running" };
  running = true;
  const started = Date.now();
  const budgetMs = numberFromEnv("ATTACHMENT_SWEEP_BUDGET_MS", 8 * 60 * 1000);
  const inTime = () => {
    const ok = Date.now() - started < budgetMs;
    if (!ok) report.outOfTime = true;
    return ok;
  };
  const holder = `${process.env.RAILWAY_DEPLOYMENT_ID ?? "local"}:${process.pid}:${randomBytes(6).toString("hex")}`;
  let leased = false;
  try {
    // 10 minutes: longer than the budget, so a run never outlives its lease.
    leased = await takeLease(SWEEP_LEASE, holder, 10 * 60);
    if (!leased) return { ...report, skipped: "leased" };
    const b = bucket();

    // 1. Uploads never confirmed. Rows a `start` has locked are skipped; the
    //    delete repeats the conditions, so a row refreshed meanwhile stays.
    while (inTime()) {
      const { rows } = await sql<{ n: number }>`
        with picked as (
          select user_id, id from attachments
          where status = 'pending' and upload_started_at < now() - interval '24 hours'
          order by upload_started_at limit ${BATCH}
          for update skip locked),
        gone as (
          delete from attachments a using picked p
          where a.user_id = p.user_id and a.id = p.id
            and a.status = 'pending' and a.upload_started_at < now() - interval '24 hours'
          returning a.storage_key),
        queued as (
          insert into storage_deletions (storage_key) select storage_key from gone
          on conflict do nothing)
        select count(*)::int as n from gone`.execute(db);
      report.expired += count(rows);
      if (count(rows) < BATCH) break;
    }

    // 2. Repair: marked photos past their grace that a note's text still
    //    names get their links back and lose the mark. The links go in
    //    before the mark is cleared (`cleared` reads from `linked`, so it
    //    waits for it): the order a note save takes (link, then photo row),
    //    so the two can't deadlock.
    while (inTime()) {
      const { rows } = await sql<{ n: number }>`
        with found as (
          select distinct n.id as note_id, a.user_id, a.id
          from attachments a
          join notes n on n.user_id = a.user_id
            and (n.content like ('%attachment:' || a.id || '%')
              or n.doc::text like ('%attachment:' || a.id || '%'))
          where a.status = 'ready' and a.orphaned_since < now() - interval '7 days'
          limit ${BATCH}),
        linked as (
          insert into note_attachments (note_id, user_id, attachment_id)
          select note_id, user_id, id from found
          on conflict do nothing
          returning 1),
        cleared as (
          update attachments a set orphaned_since = null
          from (select distinct user_id, id from found) f
          where a.user_id = f.user_id and a.id = f.id
            and (select count(*) from linked) >= 0
          returning 1)
        select (select count(*)::int from found) as n, (select count(*)::int from cleared) as cleared`.execute(db);
      report.repaired += Number((rows[0] as { cleared?: unknown } | undefined)?.cleared ?? 0);
      if (count(rows) < BATCH) break;
    }

    // 3. Orphans: marked more than 7 days ago, no link, and no note's text
    //    naming them. Every condition is repeated on the delete; rows a save
    //    holds are skipped this run.
    while (inTime()) {
      const { rows } = await sql<{ n: number }>`
        with picked as (
          select user_id, id from attachments
          where status = 'ready' and orphaned_since < now() - interval '7 days'
          order by orphaned_since limit ${BATCH}
          for update skip locked),
        gone as (
          delete from attachments a using picked p
          where a.user_id = p.user_id and a.id = p.id
            and a.status = 'ready' and a.orphaned_since < now() - interval '7 days'
            and not exists (
              select 1 from note_attachments l
              where l.user_id = a.user_id and l.attachment_id = a.id)
            and not exists (
              select 1 from notes n
              where n.user_id = a.user_id
                and (n.content like ('%attachment:' || a.id || '%')
                  or n.doc::text like ('%attachment:' || a.id || '%')))
          returning a.storage_key),
        queued as (
          insert into storage_deletions (storage_key) select storage_key from gone
          on conflict do nothing)
        select (select count(*)::int from picked) as n, (select count(*)::int from gone) as gone`.execute(db);
      report.orphans += Number((rows[0] as { gone?: unknown } | undefined)?.gone ?? 0);
      // Picked rows that something still names stay marked; step 2 gives
      // them their links back on a later batch or run, so this loop only
      // continues while full batches come back.
      if (count(rows) < BATCH) break;
      if (Number((rows[0] as { gone?: unknown } | undefined)?.gone ?? 0) === 0) break;
    }

    if (b) {
      // 4. Queued prefixes (deleted accounts): list and delete until empty.
      await emptyPrefixes(b, report, inTime);
      // 5. Queued objects that are due.
      await drain(b, report, inTime);
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from storage_deletions where attempts > ${MAX_ATTEMPTS_QUIET}`.execute(db);
      if (count(rows) > 0) {
        console.error(`sweep: ${count(rows)} queued bucket deletions have failed more than ${MAX_ATTEMPTS_QUIET} times`);
      }
    }

    // 6. Daily: due when its lease row's time has passed (or when asked).
    if (inTime() && (await takeLease(DAILY_LEASE, holder, 24 * 60 * 60, opts.daily === true))) {
      report.daily = true;
      await dailyPass(b, report, inTime);
    }
  } catch (error) {
    report.error = errorName(error);
    console.error("sweep failed:", report.error);
  } finally {
    if (leased) {
      await sql`
        update maintenance_leases set held_until = now()
        where name = ${SWEEP_LEASE} and holder = ${holder}`
        .execute(db)
        .catch((error: unknown) => console.error("sweep: lease release failed:", errorName(error)));
    }
    running = false;
  }
  const { skipped: _skipped, daily: _daily, outOfTime: _outOfTime, error: _error, reconcileRefused: _refused, ...counts } = report;
  if (Object.values(counts).some((n) => n > 0)) console.log("photo sweep:", JSON.stringify(report));
  return report;
}

/** Step 4: prefixes queued by account deletion, due now. A prefix row goes once a listing comes back empty. */
async function emptyPrefixes(b: Bucket, report: SweepReport, inTime: () => boolean) {
  const due = await db
    .selectFrom("storageDeletions")
    .select("storageKey")
    .where("isPrefix", "=", true)
    .where("notBefore", "<=", sql<Date>`now()`)
    .orderBy("notBefore")
    .limit(PREFIX_ROWS)
    .execute();
  for (const { storageKey: prefix } of due) {
    if (!inTime()) return;
    // Only ever a user's own prefix: never list or delete the whole bucket.
    if (!/^u\/\d+\/$/.test(prefix)) {
      await recordFailure(prefix, "BadPrefix");
      report.prefixesFailed++;
      continue;
    }
    let failure: string | null = null;
    let emptied = false;
    while (inTime()) {
      // Listed from the start each time: the previous page was just deleted.
      const page = await bucketTry("list", () => listPage(b, prefix));
      if (!page.ok) {
        failure = page.error;
        break;
      }
      if (page.value.objects.length === 0) {
        emptied = true;
        break;
      }
      const keys = page.value.objects.map((o) => o.key);
      const result = await bucketTry("delete", () => deleteObjects(b, keys));
      if (!result.ok) {
        failure = result.error;
        break;
      }
      if (result.value.length > 0) {
        failure = "DeleteFailed";
        break;
      }
    }
    if (emptied) {
      await db.deleteFrom("storageDeletions").where("storageKey", "=", prefix).where("isPrefix", "=", true).execute();
      report.prefixesEmptied++;
    } else if (failure) {
      await recordFailure(prefix, failure);
      report.prefixesFailed++;
    }
  }
}

/** Step 5: due object keys, oldest first, 1,000 at a time. A key that fails stays, with attempts + 1. */
async function drain(b: Bucket, report: SweepReport, inTime: () => boolean) {
  const failedThisRun: string[] = [];
  while (inTime()) {
    let query = db
      .selectFrom("storageDeletions")
      .select("storageKey")
      .where("isPrefix", "=", false)
      .where("notBefore", "<=", sql<Date>`now()`);
    // Keys that failed already this run aren't tried again until the next.
    if (failedThisRun.length > 0) query = query.where("storageKey", "not in", failedThisRun);
    const rows = await query.orderBy("notBefore").orderBy("storageKey").limit(DRAIN_BATCH).execute();
    if (rows.length === 0) return;
    const keys = rows.map((r) => r.storageKey);
    const result = await bucketTry("delete", () => deleteObjects(b, keys));
    const failed = result.ok ? new Set(result.value) : new Set(keys);
    const done = keys.filter((k) => !failed.has(k));
    if (done.length > 0) {
      await db.deleteFrom("storageDeletions").where("storageKey", "in", done).where("isPrefix", "=", false).execute();
      report.drained += done.length;
    }
    if (failed.size > 0) {
      await db
        .updateTable("storageDeletions")
        .set((eb) => ({ attempts: eb("attempts", "+", 1), lastError: result.ok ? "DeleteFailed" : result.error }))
        .where("storageKey", "in", [...failed])
        .execute();
      report.drainFailed += failed.size;
      failedThisRun.push(...failed);
    }
    // The bucket refused the whole call: try again next run.
    if (!result.ok) return;
    if (rows.length < DRAIN_BATCH) return;
  }
}

async function recordFailure(storageKey: string, error: string) {
  await db
    .updateTable("storageDeletions")
    .set((eb) => ({ attempts: eb("attempts", "+", 1), lastError: error.slice(0, 100) }))
    .where("storageKey", "=", storageKey)
    .execute();
}

/** Step 6: mark ready photos no link names, and queue bucket objects nothing knows about. */
async function dailyPass(b: Bucket | null, report: SweepReport, inTime: () => boolean) {
  // Mark (through attachments_unmarked_idx). Step 3 still reads the notes'
  // text before anything is deleted.
  while (inTime()) {
    const { rows } = await sql<{ n: number }>`
      with marked as (
        update attachments set orphaned_since = now()
        where (user_id, id) in (
          select a.user_id, a.id from attachments a
          where a.status = 'ready' and a.orphaned_since is null
            and not exists (
              select 1 from note_attachments l
              where l.user_id = a.user_id and l.attachment_id = a.id)
          limit ${MARK_BATCH})
        returning 1)
      select count(*)::int as n from marked`.execute(db);
    report.marked += count(rows);
    if (count(rows) < MARK_BATCH) break;
  }

  // A mark on a photo a link names (a save and the mark crossing) is cleared,
  // so a later removal starts its 7 days from then.
  if (inTime()) {
    const { rows } = await sql<{ n: number }>`
      with cleared as (
        update attachments a set orphaned_since = null
        where a.orphaned_since is not null
          and exists (
            select 1 from note_attachments l
            where l.user_id = a.user_id and l.attachment_id = a.id)
        returning 1)
      select count(*)::int as n from cleared`.execute(db);
    report.unmarked += count(rows);
  }

  // Reconcile: keys under u/ older than a day that neither a row nor the
  // queue knows are garbage (every key the server makes is in a row from
  // `start` until it is queued). They are queued, and a later drain deletes
  // them. The listing starts from the beginning each day.
  //
  // Only in a bucket this database owns: another database (a forked
  // environment, a local server given production's PHOTOS_*) knows none of
  // its keys and would queue every photo. And never more than a small share
  // at once, so a run that is wrong anyway can't empty the bucket.
  if (!b) return;
  if (!inTime() || !(await ownsBucket(b))) {
    if (inTime()) report.reconcileRefused = "owner";
    return;
  }
  const minAgeMs = numberFromEnv("ATTACHMENT_RECONCILE_MIN_AGE_MS", 24 * 60 * 60 * 1000);
  const maxStrays = numberFromEnv("ATTACHMENT_RECONCILE_MAX_STRAYS", MAX_STRAYS);
  const strays: string[] = [];
  let listed = 0;
  let token: string | undefined;
  // Listed in full first: nothing is queued until the whole count is known.
  do {
    if (!inTime()) break;
    const page = await bucketTry("list", () => listPage(b, "u/", token));
    if (!page.ok) return;
    listed += page.value.objects.length;
    const cutoff = Date.now() - minAgeMs;
    const old = page.value.objects.filter((o) => o.lastModified.getTime() <= cutoff).map((o) => o.key);
    if (old.length > 0) {
      const known = new Set<string>();
      for (const row of await db.selectFrom("attachments").select("storageKey").where("storageKey", "in", old).execute()) {
        known.add(row.storageKey);
      }
      for (const row of await db.selectFrom("storageDeletions").select("storageKey").where("storageKey", "in", old).execute()) {
        known.add(row.storageKey);
      }
      for (const key of old) if (!known.has(key)) strays.push(key);
    }
    if (strays.length > maxStrays) break;
    token = page.value.next;
  } while (token);

  if (strays.length > maxStrays || (strays.length > MIN_STRAYS_FOR_SHARE && strays.length > listed * MAX_STRAY_SHARE)) {
    report.reconcileRefused = "strays";
    console.error(`sweep: reconcile refused, ${strays.length}${strays.length > maxStrays ? "+" : ""} strays of ${listed} keys listed`);
    return;
  }
  for (let i = 0; i < strays.length; i += BATCH) {
    const chunk = strays.slice(i, i + BATCH);
    await db
      .insertInto("storageDeletions")
      .values(chunk.map((storageKey) => ({ storageKey })))
      .onConflict((conflict) => conflict.column("storageKey").doNothing())
      .execute();
    report.reconciled += chunk.length;
  }
}

/**
 * Where this database lives (host without Neon's "-pooler", port, database
 * name), hashed: a fork or copy of the database lives elsewhere, so it
 * can't pass for the owner even with the owner row copied.
 */
function databasePlace(): string {
  const raw = process.env.DATABASE_URL ?? process.env.FLOOT_DATABASE_URL ?? "";
  let place = "unknown";
  try {
    const url = new URL(raw);
    place = `${url.hostname.replace("-pooler.", ".")}:${url.port || "5432"}${url.pathname}`;
  } catch {
    // Not a URL: hashed as it is below, never logged.
    place = raw;
  }
  return createHash("sha256").update(place).digest("hex").slice(0, 32);
}

/**
 * Whether the bucket is this database's: the id in maintenance_leases
 * ('bucket-owner', made on the first daily pass) and this database's place
 * must match the bucket's meta/owner. A bucket with no owner file is
 * claimed. Anything else (another owner, an unreadable file, a failing
 * bucket) answers false and is logged; if this database really does own the
 * bucket (it moved, or was restored), deleting meta/owner lets it claim it again.
 */
async function ownsBucket(b: Bucket): Promise<boolean> {
  await sql`
    insert into maintenance_leases (name, holder, held_until)
    values (${OWNER_LEASE}, ${randomBytes(16).toString("hex")}, 'infinity')
    on conflict (name) do nothing`.execute(db);
  const row = await db.selectFrom("maintenanceLeases").select("holder").where("name", "=", OWNER_LEASE).executeTakeFirst();
  if (!row) return false;
  const mine = JSON.stringify({ owner: row.holder, db: databasePlace() });

  const read = await bucketTry("owner read", () => getText(b, OWNER_KEY));
  if (!read.ok) return false;
  if (read.value === null) {
    const wrote = await bucketTry("owner write", () => putText(b, OWNER_KEY, mine));
    if (!wrote.ok) return false;
    // Read back: of two databases claiming at once, only the one whose file stayed goes on.
    const again = await bucketTry("owner read", () => getText(b, OWNER_KEY));
    if (again.ok && again.value === mine) {
      console.log("sweep: claimed the photo bucket for this database (meta/owner)");
      return true;
    }
    return false;
  }
  if (read.value === mine) return true;
  console.error("sweep: reconcile refused: the photo bucket's meta/owner names another database; nothing is queued");
  return false;
}

/**
 * Starts the timer (server.ts, after serve): the first run after 2 minutes,
 * then every ATTACHMENT_SWEEP_EVERY_MS (default 15 minutes); 0 turns it off
 * (the checks call sweepAttachments directly). A run happens only when an
 * API request arrived since the previous run started: an idle server makes
 * no queries, so Neon can suspend the database. Every photo change comes
 * through a request, so nothing is skipped for good, only put off to the
 * next active spell (the daily pass keys off its lease row, so it runs on
 * the first active run after 24 hours). The timers don't keep the process
 * alive, and a failing run never stops the server.
 */
export function startAttachmentSweep(): void {
  const every = numberFromEnv("ATTACHMENT_SWEEP_EVERY_MS", 15 * 60 * 1000);
  if (every === 0) return;
  let lastRunAt = 0;
  const run = () => {
    if (lastApiActivityAt() <= lastRunAt) return;
    lastRunAt = Date.now();
    sweepAttachments().catch((error: unknown) => console.error("sweep failed:", errorName(error)));
  };
  const first = setTimeout(() => {
    run();
    const repeat = setInterval(run, every);
    // Node's timers have unref (the DOM typings in tsconfig say number).
    (repeat as unknown as { unref?: () => void }).unref?.();
  }, Math.min(FIRST_RUN_MS, every));
  (first as unknown as { unref?: () => void }).unref?.();
}
