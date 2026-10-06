// How Life's first draw grows with the number of tasks (demo mode, web build, normal speed).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--renderer-process-limit=1", "--disable-extensions"] });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
for (const copies of (process.env.COPIES || "1,2,3").split(",").map(Number)) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const script = async () => (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "ScriptDuration").value;
  await page.goto("http://localhost:8087/?demo", { waitUntil: "load", timeout: 240000 });
  await page.waitForFunction(() => /Tasks/.test(document.body.innerText), null, { timeout: 120000 });
  const count = await page.evaluate((n) => {
    for (const [id, mod] of window.__r.getModules()) {
      if (/src\/store\/store\.ts$/.test(mod.verboseName ?? "")) {
        const store = window.__r(id).useStore;
        const tasks = [];
        for (let copy = 0; copy < n; copy++) for (const task of store.getState().tasks) tasks.push({ ...task, id: `${task.id}-${copy}` });
        store.setState({ tasks });
        return tasks.length;
      }
    }
    return 0;
  }, copies);
  await page.waitForTimeout(2000);
  // A phone's pace when asked (THROTTLE=4).
  if (process.env.THROTTLE) await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.THROTTLE) });
  const before = await script();
  const t = Date.now();
  await page.getByRole("tab", { name: "Life" }).first().click({ timeout: 120000 });
  const ok = await page.waitForFunction(() => document.body.innerText.includes("Life Center") && document.body.innerText.includes("Book the dentist"), null, { timeout: 120000 }).then(() => true).catch(() => false);
  console.log(`tasks ${count}: Life on screen ${ok ? `after ${Date.now() - t} ms` : "not within 120 s"}, ${Math.round(((await script()) - before) * 1000)} ms of JavaScript`);
  await page.close();
}
await browser.close();
