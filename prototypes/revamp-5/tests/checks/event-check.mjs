// The suggestion-event endpoint and "Learn from my writing", as the TEST account against the live server
// (deployment 5474299f, 2026-10-06): with it off, an event is answered { recorded: false } and nothing is
// kept. The setting is put back as it was, whatever happens. Then run event-rows.mjs (read-only) through
// `railway run` to see that no such row exists.
import { createRequire } from "node:module";
import superjson from "/root/projects/clarity/node_modules/superjson/dist/index.js";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

const LIVE = "https://clarity-notes-production.up.railway.app";
const APP = "http://localhost:8087";
const EMAIL = process.env.SAGE_TEST_EMAIL;
if (!EMAIL || !EMAIL.includes("+clerk_test@")) throw new Error("SAGE_TEST_EMAIL must be the +clerk_test address");
export const NOT_KEPT = "Sage check: not kept";

let failures = 0;
const ok = (name, pass, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${!pass && detail ? `  (${detail})` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
// The app itself stays away from the server: only the calls below reach it.
await context.route(`${LIVE}/_api/**`, (route) => route.fulfill({ status: 503, body: "{}" }));
const page = await context.newPage();
const press = (name) => page.getByRole("button", { name, exact: true }).last().click({ timeout: 30000 });
let api;
let original = null;
try {
  await page.goto(`${APP}/`, { waitUntil: "load", timeout: 180000 });
  await press("Continue with email");
  await page.getByLabel("Email", { exact: true }).fill(EMAIL);
  await press("Continue");
  await press("Email me a code instead");
  await page.getByLabel("The code from the email", { exact: true }).fill("424242");
  await page.waitForFunction(() => window.Clerk?.session?.id, null, { timeout: 30000 });
  api = async (method, path, body) => {
    const token = await page.evaluate(() => window.Clerk.session.getToken());
    const response = await fetch(`${LIVE}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : superjson.stringify(body) });
    return { status: response.status, data: superjson.parse(await response.text()) };
  };
  const session = await api("GET", "/_api/auth/session");
  if (session.data?.user?.email !== EMAIL) throw new Error(`signed in as ${session.data?.user?.email}: stopping before any write`);
  ok("signed in as the test account", true);

  original = (await api("GET", "/_api/preferences")).data.usePersonalization;
  console.log(`  Learn from my writing was ${original ? "on" : "off"}`);
  const off = await api("POST", "/_api/preferences", { usePersonalization: false });
  ok("Learn from my writing turned off", off.status === 200 && off.data.usePersonalization === false);
  const sent = await api("POST", "/_api/suggestions/event", { suggestionText: NOT_KEPT, source: "ai", action: "shown" });
  ok("with it off, an event is answered: not recorded", sent.status === 200 && sent.data.recorded === false, JSON.stringify(sent));
} catch (error) {
  failures++;
  console.log("FAIL the run stopped:", error.message.split("\n")[0]);
} finally {
  if (api && original !== null) {
    const back = await api("POST", "/_api/preferences", { usePersonalization: original }).catch(() => null);
    const now = await api("GET", "/_api/preferences").catch(() => null);
    ok("Learn from my writing is back as it was", back?.status === 200 && now?.data?.usePersonalization === original, JSON.stringify(now?.data));
  }
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}
