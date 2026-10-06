const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const OUT = "/root/projects/clarity-design-research/revamp-5/auth";
(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
  for (const scheme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://localhost:8087/first-run?firstrun", { waitUntil: "load", timeout: 180000 });
    await page.waitForFunction(() => /Write freely/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    for (let i = 1; i <= 3; i++) { await page.screenshot({ path: `${OUT}/f_${i}_${scheme}.png` }); await page.getByRole("button", { name: "Next", exact: true }).click(); await page.waitForTimeout(900); }
    await page.screenshot({ path: `${OUT}/f_4_${scheme}.png` });
    await page.getByRole("radio", { name: "Plum" }).click(); await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/f_5_${scheme}.png` });
    console.log(scheme, errors.length ? "ERR " + errors.join(" | ").slice(0, 300) : "ok", (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").slice(0, 160));
    await context.close();
  }
  await browser.close();
})();
