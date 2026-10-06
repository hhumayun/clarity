// Sign-in flows of revamp 5 in headless Chrome. node auth.js <step...>
// Steps: welcome | demo | email:<address> | create:<password> | code:<digits> | firstrun | settings | signout | password:<password>
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const OUT = "/root/projects/clarity-design-research/revamp-5/auth";
const BASE = process.env.BASE || "http://localhost:8087";
const scheme = process.env.SCHEME || "light";
const fs = require("fs");
fs.mkdirSync(OUT, { recursive: true });
const STATE = "/tmp/clarity-revamp-5/auth-state.json";

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
  const keep = process.env.KEEP && fs.existsSync(STATE) ? { storageState: STATE } : {};
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true, ...keep });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 240)}`); });
  let n = 0;
  const shot = async (name) => {
    n += 1;
    await page.screenshot({ path: `${OUT}/${String(n).padStart(2, "0")}_${name}_${scheme}.png` });
    const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").slice(0, 260);
    console.log(`shot ${name}: ${text}`);
    if (errors.length) console.log(`  ERRORS: ${errors.splice(0).join(" | ").slice(0, 700)}`);
  };
  const veil = async () => page.waitForFunction(() => document.body.innerText.trim().length > 0 && !/^\s*clarity\s*$/.test(document.body.innerText.trim()), null, { timeout: 30000 }).catch(() => {});
  const press = async (name) => { await page.getByRole("button", { name, exact: true }).first().click(); };
  try {
    await page.goto(`${BASE}/${process.env.QUERY || ""}`, { waitUntil: "load", timeout: 180000 });
    await veil();
    await page.waitForTimeout(2500);
    for (const step of process.argv.slice(2)) {
      const [kind, ...rest] = step.split(":");
      const arg = rest.join(":");
      if (kind === "welcome") { await shot("welcome"); }
      else if (kind === "look") { await press("Look around first"); await page.waitForTimeout(2500); await shot("looking_around_today"); }
      else if (kind === "settings") { await page.goto(`${BASE}/settings`, { waitUntil: "load" }); await veil(); await page.waitForTimeout(2500); await shot("settings"); }
      else if (kind === "email") { await press("Continue with email"); await page.waitForTimeout(1200); await shot("email"); await page.getByLabel("Email", { exact: true }).fill(arg); await page.waitForTimeout(300); await press("Continue"); await page.waitForTimeout(3500); await shot("after_email"); }
      else if (kind === "create") { await page.getByLabel("Password", { exact: true }).fill(arg); await page.waitForTimeout(300); await shot("create_filled"); await press("Create account"); await page.waitForTimeout(5000); await shot("after_create"); }
      else if (kind === "password") { await page.getByLabel("Password", { exact: true }).fill(arg); await press("Sign in"); await page.waitForTimeout(5000); await shot("after_password"); }
      else if (kind === "code") { await page.getByLabel("The code from the email", { exact: true }).fill(arg); await page.waitForTimeout(400); await shot("code_typed"); await page.waitForTimeout(5000); await shot("after_code"); }
      else if (kind === "firstrun") { for (let i = 0; i < 3; i++) { await shot(`firstrun_${i + 1}`); await press("Next"); await page.waitForTimeout(900); } await shot("firstrun_colour"); await page.getByRole("radio", { name: "Rose" }).click(); await page.waitForTimeout(800); await shot("firstrun_rose"); await press("Start writing"); await page.waitForTimeout(3000); await shot("after_firstrun"); }
      else if (kind === "signout") { await press("Sign out"); await page.waitForTimeout(700); await shot("signout_ask"); await page.getByRole("button", { name: "Sign out", exact: true }).last().click(); await page.waitForTimeout(4000); await shot("after_signout"); }
      else if (kind === "emailcode") { await press("Email me a code instead"); await page.waitForTimeout(3000); await shot("code_screen"); await page.getByLabel("The code from the email", { exact: true }).fill(arg || "424242"); await page.waitForTimeout(6000); await shot("after_emailcode"); }
      else if (kind === "opensettings") { await page.getByRole("button", { name: "Settings" }).first().click(); await page.waitForTimeout(2500); await shot("settings_signed_in"); }
      else if (kind === "wait") { await page.waitForTimeout(Number(arg) || 2000); await shot("waited"); }
    }
    await context.storageState({ path: STATE });
  } catch (e) {
    console.log("FAILED", e.message.split("\n")[0]);
    await shot("failed").catch(() => {});
  }
  await browser.close();
})();
