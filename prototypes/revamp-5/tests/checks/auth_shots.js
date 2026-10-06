// Screenshots of the sign-in screens, opened directly. node auth_shots.js <light|dark>
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const OUT = "/root/projects/clarity-design-research/revamp-5/auth";
const BASE = "http://localhost:8087";
const scheme = process.argv[2] || "light";
(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true });
  const errors = [];
  let page = null;
  const open = async (path) => {
    if (page) await page.close();
    page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 180000 });
    await page.waitForFunction(() => document.body.innerText.trim().length > 0 && !/^\s*clarity\s*$/.test(document.body.innerText.trim()), null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2200);
  };
  const shot = async (name) => { await page.screenshot({ path: `${OUT}/s_${name}_${scheme}.png` }); console.log("shot", name, errors.length ? "ERR " + errors.splice(0).join(" | ").slice(0, 300) : ""); };
  const email = encodeURIComponent("someone@example.com");
  try {
    await open("/welcome"); await shot("welcome");
    await open("/email"); await page.getByLabel("Email", { exact: true }).fill("someone@exam"); await page.waitForTimeout(300); await shot("email_typing");
    await open(`/create?email=${email}`); await page.getByLabel("Password", { exact: true }).fill("short"); await shot("create");
    await open(`/password?email=${email}`); await shot("password");
    await open(`/code?email=${email}&purpose=signup`); await page.getByLabel("The code from the email", { exact: true }).fill("123"); await page.waitForTimeout(500); await shot("code_typing");
    await page.getByLabel("The code from the email", { exact: true }).fill("123456"); await page.waitForTimeout(150); await shot("code_sent"); await page.waitForTimeout(2500); await shot("code_wrong");
    await open(`/new-password?email=${email}`); await shot("new_password");
  } catch (e) { console.log("FAILED", e.message.split("\n")[0]); }
  await browser.close();
})();
