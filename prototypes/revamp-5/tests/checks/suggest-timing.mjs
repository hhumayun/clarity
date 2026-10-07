// How long word help takes, as the TEST account, against the live server: /_api/suggestions/generate,
// timed from the request to the answer, for words that stop mid-sentence and words that end one, and
// what comes back (ways to finish, ways to start the next, questions). Writes nothing.
// ROUNDS (default 3) asks per kind of text. MODES (default "all"): which modes to ask in, of all, words
// and questions (servers from 2026-10-07). SERVER: another server to ask (one run locally, say); the
// sign-in still goes through the live one.
import { createRequire } from "node:module";
import superjson from "/root/projects/clarity/node_modules/superjson/dist/index.js";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

const LIVE = "https://clarity-notes-production.up.railway.app";
const APP = "http://localhost:8087";
const EMAIL = process.env.SAGE_TEST_EMAIL;
if (!EMAIL || !EMAIL.includes("+clerk_test@")) throw new Error("SAGE_TEST_EMAIL must be the +clerk_test address");
const ROUNDS = Number(process.env.ROUNDS || 3);
const SERVER = process.env.SERVER || LIVE;
const MODES = (process.env.MODES || "all").split(",");
const TEXTS = {
  "mid-sentence": "We walked by the canal for an hour this morning, and the light on the water was",
  "sentence over": "We walked by the canal for an hour this morning. The light on the water was soft and grey.",
  "short, mid": "Today I felt",
};

const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
const cors = { "access-control-allow-origin": APP, "access-control-allow-headers": "Authorization, Content-Type", "access-control-allow-methods": "GET, POST, OPTIONS" };
await context.route(`${LIVE}/_api/**`, async (route) => {
  if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  const response = await route.fetch();
  return route.fulfill({ response, headers: { ...response.headers(), ...cors } });
});
const page = await context.newPage();
const press = (name) => page.getByRole("button", { name, exact: true }).first().click({ timeout: 30000 });
try {
  await page.goto(`${APP}/`, { waitUntil: "load", timeout: 180000 });
  await press("Continue with email");
  await page.getByLabel("Email", { exact: true }).fill(EMAIL);
  await press("Continue");
  await press("Email me a code instead");
  await page.getByLabel("The code from the email", { exact: true }).fill("424242", { timeout: 30000 });
  await page.waitForFunction(() => window.Clerk?.session?.id, null, { timeout: 30000 });
  const token = () => page.evaluate(() => window.Clerk.session.getToken());
  const who = await (await fetch(`${LIVE}/_api/auth/session`, { headers: { Authorization: `Bearer ${await token()}` } })).text();
  if (!who.includes(EMAIL)) throw new Error("not signed in as the test account");

  // The server's own overhead, for comparison: who's signed in, and the preferences (one small read each).
  for (const path of ["/_api/auth/session", "/_api/preferences"]) {
    const times = [];
    for (let round = 0; round < ROUNDS; round++) {
      const auth = await token();
      const start = performance.now();
      await (await fetch(`${SERVER}${path}`, { headers: { Authorization: `Bearer ${auth}` } })).text();
      times.push(Math.round(performance.now() - start));
    }
    times.sort((a, b) => a - b);
    console.log(`  ${path}: median ${times[Math.floor(times.length / 2)]} ms, ${times[0]}–${times.at(-1)} ms`);
  }

  for (const mode of MODES)
  for (const [name, text] of Object.entries(TEXTS)) {
    const kind = `${mode} ${name}`;
    const times = [];
    for (let round = 0; round < ROUNDS; round++) {
      const auth = await token();
      const start = performance.now();
      const response = await fetch(`${SERVER}/_api/suggestions/generate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
        body: superjson.stringify({ title: "", textBeforeCursor: text, ...(mode === "all" ? {} : { mode }) }),
      });
      const raw = await response.text();
      const ms = Math.round(performance.now() - start);
      times.push(ms);
      let data;
      try {
        data = superjson.parse(raw);
      } catch {
        data = raw;
      }
      if (response.status !== 200) {
        console.log(`${kind} #${round + 1}: ${response.status} in ${ms} ms: ${String(raw).slice(0, 200)}`);
        continue;
      }
      const finishes = data.completionSuggestions.map((item) => item.text);
      const starts = data.suggestions.map((item) => `${item.category}:${item.text}`);
      const timing = response.headers.get("server-timing");
      console.log(`${kind} #${round + 1}: ${ms} ms${timing ? ` (${timing})` : ""}; finish ${finishes.length} ${JSON.stringify(finishes)}; start ${starts.length} ${JSON.stringify(starts)}; questions ${data.reflectionQuestions.length}`);
    }
    times.sort((a, b) => a - b);
    console.log(`  ${kind}: median ${times[Math.floor(times.length / 2)]} ms, ${times[0]}–${times.at(-1)} ms`);
  }
} finally {
  await browser.close();
}
