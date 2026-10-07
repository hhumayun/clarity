// Word help as the TEST account, in the web build, with AI help on (2026-10-07, after the phone test:
// slow, random, starts never showing, the strip going on every key and on a pick):
// - after a pause mid-sentence, the strip comes within a few seconds with both rows: ways to finish the
//   sentence over ways to start the next;
// - typing the start of a way to finish keeps it, and the strip stays, not changing with every key;
// - a pick puts the words in, and the strip stays (more coming) until new words come;
// - ending the sentence keeps the ways to start the next.
// SERVER sends the suggestion asks to another server (the branch's run locally, say); everything else
// goes to the live one. AI help is a setting on the device (this browser). Writes one "Sage check"
// note and deletes it.
import { createRequire } from "node:module";
import superjson from "/root/projects/clarity/node_modules/superjson/dist/index.js";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

const LIVE = "https://clarity-notes-production.up.railway.app";
const SERVER = process.env.SERVER || LIVE;
const APP = "http://localhost:8087";
const EMAIL = process.env.SAGE_TEST_EMAIL;
if (!EMAIL || !EMAIL.includes("+clerk_test@")) throw new Error("SAGE_TEST_EMAIL must be the +clerk_test address");
const MID = "Sage check: we walked by the canal for an hour this morning, and the light on the water was";

let failures = 0;
const ok = (name, pass, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${!pass && detail ? `  (${detail})` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--renderer-process-limit=1", "--disable-extensions"] });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const cors = { "access-control-allow-origin": APP, "access-control-allow-headers": "Authorization, Content-Type", "access-control-allow-methods": "GET, POST, OPTIONS" };
const asks = [];
await context.route(`${LIVE}/_api/**`, async (route) => {
  const request = route.request();
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  const path = new URL(request.url()).pathname;
  if (path === "/_api/suggestions/generate") {
    const body = superjson.parse(request.postData() ?? "{}");
    const ask = { at: Date.now(), mode: body.mode ?? "all", before: body.textBeforeCursor, ms: null, timing: null };
    asks.push(ask);
    const response = await route.fetch({ url: `${SERVER}${path}` });
    ask.ms = Date.now() - ask.at;
    ask.timing = response.headers()["server-timing"] ?? null;
    return route.fulfill({ response, headers: { ...response.headers(), ...cors } });
  }
  const response = await route.fetch();
  return route.fulfill({ response, headers: { ...response.headers(), ...cors } });
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const press = (name) => page.getByRole("button", { name, exact: true }).first().click({ timeout: 30000 });
const btn = (name) => page.getByRole("button", { name, exact: false }).first();
const chips = () => page.getByRole("button", { name: /^Add “/ });
const labels = async () => (await chips().evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")))).map((label) => label.replace(/^Add “|”$/g, ""));
// The strip's rows as drawn: each row's chips, top to bottom.
const rows = () =>
  page.evaluate(() => {
    const found = [...document.querySelectorAll('[aria-label^="Add “"]')].map((el) => ({ top: Math.round(el.getBoundingClientRect().top), text: el.innerText }));
    const byTop = new Map();
    for (const chip of found) byTop.set(chip.top, [...(byTop.get(chip.top) ?? []), chip.text]);
    return [...byTop.entries()].sort((a, b) => a[0] - b[0]).map(([, texts]) => texts);
  });
const words = async () => (await page.frames().filter((frame) => frame.url() === "about:srcdoc" && !frame.isDetached()).at(-1)?.evaluate(() => document.querySelector(".ProseMirror")?.innerText ?? "")) ?? "";
const waitFor = async (check, ms = 15000, every = 100) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return true;
    await page.waitForTimeout(every);
  }
  return false;
};

let api;
try {
  await page.goto(`${APP}/`, { waitUntil: "load", timeout: 180000 });
  await press("Continue with email");
  await page.getByLabel("Email", { exact: true }).fill(EMAIL);
  await press("Continue");
  await press("Email me a code instead");
  await page.getByLabel("The code from the email", { exact: true }).fill("424242", { timeout: 30000 });
  await page.waitForFunction(() => window.Clerk?.session?.id, null, { timeout: 30000 });
  api = async (method, path, body) => {
    const token = await page.evaluate(() => window.Clerk.session.getToken());
    const response = await fetch(`${LIVE}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : superjson.stringify(body) });
    const raw = await response.text();
    try {
      return { status: response.status, data: superjson.parse(raw) };
    } catch {
      return { status: response.status, data: raw };
    }
  };
  const session = await api("GET", "/_api/auth/session");
  if (session.data?.user?.email !== EMAIL) throw new Error(`Signed in as ${session.data?.user?.email ?? "nobody"}, not the test account: stopping before any write.`);
  ok("signed in as the test account", true);
  console.log(`  suggestion asks go to ${SERVER}`);

  // The opening screens, skipped; AI help turned on when it's asked about (on this device).
  await page.waitForFunction(() => /Write freely/.test(document.body.innerText), null, { timeout: 60000 });
  await press("Skip");
  await waitFor(async () => /Gentle help/.test(await page.evaluate(() => document.body.innerText)), 20000);
  await press("Turn on AI help");
  await page.waitForFunction(() => /Today/.test(document.body.innerText) && !/Gentle help/.test(document.body.innerText), null, { timeout: 60000 });
  await page.waitForTimeout(1500);

  // A new note, written to mid-sentence, then a pause.
  await btn("New note or task").click();
  await page.waitForTimeout(600);
  await btn("New note").click();
  await page.waitForFunction(() => document.querySelector('iframe[title="Note"]')?.contentDocument?.querySelector(".ProseMirror"), null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  const frame = page.frames().filter((f) => f.url() === "about:srcdoc" && !f.isDetached()).at(-1);
  await frame.locator(".ProseMirror").click();
  await page.keyboard.type(MID, { delay: 12 });
  const stopped = Date.now();
  const came = await waitFor(async () => (await chips().count()) > 0, 12000, 50);
  const after = Date.now() - stopped;
  ok("a pause mid-sentence brings word help within a few seconds", came && after < 5000, `${after} ms`);
  console.log(`  strip after ${after} ms (asks: ${asks.map((a) => `${a.mode} ${a.ms} ms${a.timing ? ` [${a.timing}]` : ""}`).join("; ")})`);
  await page.waitForTimeout(400);
  const first = await rows();
  ok("…with two rows: ways to finish the sentence over ways to start the next", first.length === 2 && first[0].every((t) => t.startsWith("…")) && first[1].every((t) => !t.startsWith("…")), JSON.stringify(first));
  ok("…and ways to start the next are there to see", (first[1] ?? []).length >= 2, JSON.stringify(first[1]));

  // Typing the start of a way to finish: it stays, and the strip doesn't change with every key.
  const finishes = (first[0] ?? []).map((t) => t.slice(1));
  const target = finishes[0] ?? "";
  const begun = target.split(" ")[0];
  const asksBefore = asks.length;
  for (const letter of ` ${begun}`) {
    await page.keyboard.type(letter);
    await page.waitForTimeout(60);
    const now = await labels();
    if (!now.includes(target)) {
      ok(`typing "${begun}" keeps "${target}"`, false, `gone after "${letter}": ${JSON.stringify(now)}`);
      break;
    }
  }
  const narrowed = await labels();
  ok(`typing its first word keeps "${target}"`, narrowed.includes(target), JSON.stringify(narrowed));
  ok("…and the ways to start the next stay too", (first[1] ?? []).every((t) => narrowed.includes(t)), JSON.stringify(narrowed));
  ok("…without asking again while it fits", asks.length === asksBefore, `${asks.length - asksBefore} more asks`);

  // A pick: the words go in, and the strip stays while new ones come.
  const pickedAt = asks.length;
  await page.getByRole("button", { name: `Add “${target}”` }).first().click();
  const watch = [];
  const picked = Date.now();
  while (Date.now() - picked < 4000) {
    watch.push({ t: Date.now() - picked, chips: await chips().count(), more: await page.getByLabel("More words coming").count() });
    await page.waitForTimeout(80);
  }
  ok("a pick puts the rest of the words in", (await words()).includes(`${MID} ${target}`), JSON.stringify(await words()));
  ok("…the strip stays up after the pick", watch.every((w) => w.chips > 0 || w.more > 0), JSON.stringify(watch.filter((w) => !w.chips && !w.more).slice(0, 3)));
  ok("…new words are asked for at once", asks.length > pickedAt && asks[pickedAt].at - picked < 600, asks[pickedAt] ? `${asks[pickedAt].at - picked} ms` : "no ask");
  const fresh = await labels();
  ok("…and come", fresh.length > 0 && !fresh.includes(target), JSON.stringify(fresh));

  // The sentence ended: the ways to start the next stay (or come).
  await page.keyboard.type(".");
  await waitFor(async () => (await rows()).length === 1 && !(await rows())[0][0]?.startsWith("…"), 6000);
  const ended = await rows();
  ok("ending the sentence leaves the ways to start the next", ended.length === 1 && ended[0].length > 0 && ended[0].every((t) => !t.startsWith("…")), JSON.stringify(ended));

  await btn("Put the keyboard away").click();
  await page.waitForTimeout(500);
  ok("with the keyboard away, no strip", (await chips().count()) === 0);
  await press("Done");
  await page.waitForTimeout(3000);
  console.log(`  asks: ${asks.map((a) => `${a.mode} ${a.ms} ms`).join(", ")}`);
} catch (error) {
  failures++;
  console.log("FAIL the run stopped:", error.message.split("\n")[0]);
} finally {
  // Nothing of this run stays on the account.
  if (api) {
    const listed = await api("GET", "/_api/notes/list").catch(() => null);
    for (const note of listed?.data?.notes ?? []) if (note.content.includes("Sage check")) await api("POST", "/_api/notes/delete", { id: note.id });
  }
  ok("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}
