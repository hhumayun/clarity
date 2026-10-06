// The opening screens as the TEST account, on a phone new to Sage: their second page asks about
// AI help, with what that means; "Turn on AI help" moves on, and Settings then shows it on. Back
// on that page and choosing "Not now" leaves it off. Writes nothing to the account.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

const APP = "http://localhost:8087";
const LIVE = "https://clarity-notes-production.up.railway.app";
const OUT = "/root/projects/clarity-design-research/revamp-5/shots/first-run";
const EMAIL = process.env.SAGE_TEST_EMAIL;
if (!EMAIL || !EMAIL.includes("+clerk_test@")) throw new Error("SAGE_TEST_EMAIL must be the +clerk_test address");
mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (name, pass, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${!pass && detail ? `  (${detail})` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--renderer-process-limit=1", "--disable-extensions"] });
const errors = [];
const writes = [];
const cors = { "access-control-allow-origin": APP, "access-control-allow-headers": "Authorization, Content-Type", "access-control-allow-methods": "GET, POST, OPTIONS" };

// One fresh phone per run: signed in, at the opening screens.
async function freshPhone(scheme) {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, colorScheme: scheme, isMobile: true, hasTouch: true });
  await context.route(`${LIVE}/_api/**`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (request.method() === "POST") writes.push(new URL(request.url()).pathname);
    const response = await route.fetch();
    return route.fulfill({ response, headers: { ...response.headers(), ...cors } });
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const press = (name) => page.getByRole("button", { name, exact: true }).first().click({ timeout: 30000 });
  await page.goto(`${APP}/`, { waitUntil: "load", timeout: 180000 });
  await press("Continue with email");
  await page.getByLabel("Email", { exact: true }).fill(EMAIL);
  await press("Continue");
  await press("Email me a code instead");
  await page.getByLabel("The code from the email", { exact: true }).fill("424242", { timeout: 30000 });
  await page.waitForFunction(() => /Write freely/.test(document.body.innerText), null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  return { context, page, press, text: () => page.evaluate(() => document.body.innerText) };
}

try {
  // Light: through the pages, turning AI help on.
  let { context, page, press, text } = await freshPhone("light");
  await page.screenshot({ path: `${OUT}/1-write.png` });
  await press("Next");
  await page.waitForTimeout(900);
  ok("the second page asks about AI help", /Gentle help/.test(await text()));
  ok("…saying what it does and where the words go", /finds the tasks/.test(await text()) && /don't keep it or use it for training/.test(await text()));
  ok("…with Not now beside Turn on AI help, and no plain Next", (await page.getByRole("button", { name: "Not now", exact: true }).count()) === 1 && (await page.getByRole("button", { name: "Turn on AI help", exact: true }).count()) === 1 && (await page.getByRole("button", { name: "Next", exact: true }).count()) === 0);
  await page.screenshot({ path: `${OUT}/2-help.png` });
  await press("Turn on AI help");
  await page.waitForTimeout(900);
  ok("Turn on AI help moves on to the next page", /Yours alone/.test(await text()));
  ok("…which says where AI help is turned on or off", /Turn AI help on or off/.test(await text()));
  await page.screenshot({ path: `${OUT}/3-yours.png` });
  await press("Next");
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/4-colour.png` });
  await press("Start writing");
  await page.waitForFunction(() => /Today/.test(document.body.innerText), null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  ok("the app opens, with no second question about AI", !/Gentle help/.test(await text()));
  await page.goto(`${APP}/settings`, { waitUntil: "load", timeout: 180000 });
  await page.waitForTimeout(3000);
  ok("Settings shows AI help on", await page.getByRole("switch", { name: "AI help" }).isChecked());
  await context.close();

  // Dark: Not now leaves it off.
  ({ context, page, press, text } = await freshPhone("dark"));
  await press("Next");
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/2-help-dark.png` });
  await press("Not now");
  await page.waitForTimeout(900);
  ok("Not now moves on too", /Yours alone/.test(await text()));
  await press("Next");
  await page.waitForTimeout(600);
  await press("Start writing");
  await page.waitForFunction(() => /Today/.test(document.body.innerText), null, { timeout: 30000 });
  await page.goto(`${APP}/settings`, { waitUntil: "load", timeout: 180000 });
  await page.waitForTimeout(3000);
  ok("Settings shows AI help off", !(await page.getByRole("switch", { name: "AI help" }).isChecked()));
  await context.close();

  ok("nothing was written to the account", writes.length === 0, writes.join(", "));
} catch (error) {
  failures++;
  console.log("FAIL the run stopped:", error.message.split("\n")[0]);
} finally {
  ok("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}
