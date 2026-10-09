// Shared pieces for the photo checks (docs/photos-server.md, 11): the local
// stack's addresses, a connection to the local database, an S3 client for the
// local bucket, signing in as the Clerk test account to get tokens, and a
// small PASS/FAIL reporter. Everything here talks to this machine only,
// except Clerk (production's, sign-in and token checks only).
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import postgres from "postgres";
import superjson from "superjson";
import { S3Client, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "../..");
const require = createRequire(import.meta.url);

// CHECK_PG_PORT / CHECK_SERVER_PORT / CHECK_BUCKET: a second database, server and bucket (see local-env.sh).
export const PORTS = { pg: Number(process.env.CHECK_PG_PORT || 5440), s3: 9400, server: Number(process.env.CHECK_SERVER_PORT || 3410), proxy: 8095 };
export const SERVER = process.env.SERVER || `http://localhost:${PORTS.server}`;
export const APP = process.env.APP || `http://localhost:${PORTS.proxy}`;
export const LOCAL = {
  DATABASE_URL: `postgres://postgres@localhost:${PORTS.pg}/postgres`,
  PHOTOS_BUCKET: process.env.CHECK_BUCKET || "clarity-photos-local",
  PHOTOS_ACCESS_KEY_ID: "labkey",
  PHOTOS_SECRET_ACCESS_KEY: "labsecret123",
  PHOTOS_ENDPOINT: `http://127.0.0.1:${PORTS.s3}`,
  PHOTOS_REGION: "auto",
  PHOTOS_PATH_STYLE: "1",
};
export const STACK_DIR = process.env.PHOTOS_STACK_DIR || "/root/.cache/photos-stack";
export const NODE = "/opt/node24/bin/node";
/** The CHECK_* and PHOTOS_STACK_DIR choices, for child processes started with a clean environment. */
export const CHECK_ENV = Object.fromEntries(
  ["CHECK_PG_PORT", "CHECK_SERVER_PORT", "CHECK_BUCKET", "PHOTOS_STACK_DIR"].filter((k) => process.env[k]).map((k) => [k, process.env[k]]),
);

// Never anything but the local server and database.
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(SERVER)) throw new Error(`SERVER must be local, not ${SERVER}`);

export const sql = postgres(LOCAL.DATABASE_URL, { max: 1, prepare: false, ssl: false, onnotice: () => {} });

export const s3 = new S3Client({
  region: LOCAL.PHOTOS_REGION,
  endpoint: LOCAL.PHOTOS_ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: LOCAL.PHOTOS_ACCESS_KEY_ID, secretAccessKey: LOCAL.PHOTOS_SECRET_ACCESS_KEY },
  maxAttempts: 1,
});
export const Bucket = LOCAL.PHOTOS_BUCKET;

/** Size and type of an object in the local bucket, or null. */
export async function headKey(key) {
  try {
    const out = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
    return { bytes: out.ContentLength, contentType: out.ContentType };
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") return null;
    throw error;
  }
}
export async function listKeys(prefix) {
  const keys = [];
  let token;
  do {
    const out = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }));
    for (const o of out.Contents ?? []) keys.push(o.Key);
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return keys;
}
export async function putKey(key, body, contentType = "image/jpeg") {
  await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
}
export async function emptyPrefix(prefix) {
  const keys = await listKeys(prefix);
  for (let i = 0; i < keys.length; i += 1000) {
    await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true } }));
  }
  return keys.length;
}

/** Bytes that start like a JPEG; the server never looks inside them. */
export function photoBytes(n, seed = 1) {
  const b = Buffer.alloc(n);
  let x = seed * 2654435761 >>> 0;
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24; }
  if (n >= 3) { b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; }
  return b;
}

let counter = 0;
/** A fresh photo id that passes ^[A-Za-z0-9-]{8,64}$. */
export const newId = (tag = "p") => `${tag}-${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// --- reporting -----------------------------------------------------------------

let passed = 0;
let failed = 0;
export const results = { get passed() { return passed; }, get failed() { return failed; } };
export function ok(name, pass, detail = "") {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${!pass && detail ? `  (${detail})` : ""}`);
  return pass;
}
export const section = (title) => console.log(`\n== ${title}`);
/** Runs one numbered group; a crash inside fails it and the run goes on. */
export async function group(title, fn) {
  section(title);
  try {
    await fn();
  } catch (error) {
    ok(`${title}: ran to the end`, false, String(error?.message ?? error).split("\n")[0]);
  }
}

// --- the test account ----------------------------------------------------------

export function testEmail() {
  let email = process.env.SAGE_TEST_EMAIL;
  if (!email && existsSync("/root/.config/clarity-sage-test.env")) {
    const line = readFileSync("/root/.config/clarity-sage-test.env", "utf8").split("\n").find((l) => l.startsWith("SAGE_TEST_EMAIL="));
    email = line?.slice("SAGE_TEST_EMAIL=".length).replace(/^["']|["']$/g, "").trim();
  }
  if (!email || !email.includes("+clerk_test@")) throw new Error("SAGE_TEST_EMAIL must be the +clerk_test address");
  return email;
}

export const CHROME_ARGS = ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--renderer-process-limit=1", "--disable-extensions"];
export function chromium() {
  const pw = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
  return pw.chromium;
}

/**
 * Signs in to Sage's web build (through the second web proxy on :8095, so
 * the app's own calls reach the local server) as the Clerk test account, and
 * answers an `api` that sends requests to the local server with a fresh
 * token each time (tokens last about a minute).
 */
export async function signIn({ browser: given, app = APP } = {}) {
  const EMAIL = testEmail();
  const browser = given ?? (await chromium().launch({ executablePath: "/opt/google/chrome/chrome", args: CHROME_ARGS }));
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const press = (name) => page.getByRole("button", { name, exact: true }).first().click({ timeout: 60000 });
  await page.goto(`${app}/`, { waitUntil: "load", timeout: 180000 });
  await press("Continue with email");
  await page.getByLabel("Email", { exact: true }).fill(EMAIL);
  await press("Continue");
  await press("Email me a code instead");
  await page.getByLabel("The code from the email", { exact: true }).fill("424242", { timeout: 30000 });
  await page.waitForFunction(() => window.Clerk?.session?.id, null, { timeout: 30000 });
  const token = () => page.evaluate(() => window.Clerk.session.getToken());
  const api = makeApi(token);
  const session = await api("GET", "/_api/auth/session");
  if (session.data?.user?.email !== EMAIL) throw new Error(`Signed in as ${session.data?.user?.email ?? "nobody"}, not the test account: stopping.`);
  return { browser, context, page, api, token, email: EMAIL, close: () => (given ? context.close() : browser.close()) };
}

/** Requests to the local server; answers { status, data, text, headers }. */
export function makeApi(token) {
  return async (method, path, body, { raw = false } = {}) => {
    const headers = { "Content-Type": "application/json" };
    const t = token ? await token() : null;
    if (t) headers.Authorization = `Bearer ${t}`;
    const response = await fetch(`${SERVER}${path}`, { method, headers, body: body === undefined ? undefined : raw ? body : superjson.stringify(body) });
    const text = await response.text();
    let data = null;
    try { data = superjson.parse(text); } catch { try { data = JSON.parse(text); } catch { data = null; } }
    return { status: response.status, data, text, headers: response.headers };
  };
}

// --- server helpers in-process (tsx) -------------------------------------------

/**
 * Runs `call.ts`: one exported function of a server helper, in a tsx process
 * with the local stack's variables (and `extraEnv`). Answers its JSON result.
 */
export function callHelper(modulePath, exportName, args = [], { extraEnv = {}, photos = true, timeout = 120000 } = {}) {
  const env = { PATH: `/opt/node24/bin:/usr/bin:/bin`, HOME: process.env.HOME, DATABASE_URL: LOCAL.DATABASE_URL, ...(photos ? LOCAL : { DATABASE_URL: LOCAL.DATABASE_URL }), ATTACHMENT_SWEEP_EVERY_MS: "0", ...extraEnv };
  const out = spawnSync(NODE, [join(ROOT, "node_modules/.bin/tsx"), join(HERE, "call.ts"), modulePath, exportName, JSON.stringify(args)], { cwd: ROOT, env, encoding: "utf8", timeout });
  const line = (out.stdout || "").split("\n").reverse().find((l) => l.startsWith("RESULT "));
  if (!line) throw new Error(`call.ts ${modulePath} ${exportName}: ${(out.stderr || out.stdout || "no output").trim().split("\n").slice(-3).join(" | ")}`);
  return JSON.parse(line.slice("RESULT ".length));
}

/** Restarts the local server through run-server.sh (Clerk keys read there, at run time). */
export function restartServer(options = []) {
  spawnSync(join(HERE, "run-server.sh"), ["--stop"], { encoding: "utf8" });
  const out = spawnSync(join(HERE, "run-server.sh"), ["--background", ...options], { encoding: "utf8", timeout: 120000 });
  if (out.status !== 0) throw new Error(`run-server.sh: ${(out.stdout + out.stderr).trim()}`);
}

export function stack(command) {
  const out = spawnSync(join(HERE, "stack.sh"), [command], { encoding: "utf8", timeout: 120000 });
  if (out.status !== 0) throw new Error(`stack.sh ${command}: ${(out.stdout + out.stderr).trim()}`);
  return out.stdout;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { superjson };
