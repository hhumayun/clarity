// Repeats and reminders, separate (demo mode, web build): the Repeats row has
// its own sheet; a repeating task's reminder can be for this time only; ticking
// the task off brings it back without that reminder; "No reminder" keeps the repeat.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const BASE = process.env.BASE || "http://localhost:8087";
let failures = 0;
const ok = (name, pass, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${!pass && detail ? `  (${detail})` : ""}`);
};
const browser = await chromium.launch({ executablePath: "/opt/google/chrome/chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--renderer-process-limit=1", "--disable-extensions"] });
const page = await (await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true })).newPage();
// The morning of today, whenever this runs: the task under test reminds at 12:30, and after that the
// sheet rightly says a this-time-only reminder has already passed.
const morning = new Date();
morning.setHours(8, 0, 0, 0);
await page.clock.setFixedTime(morning);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const row = (label) => page.getByRole("button", { name: new RegExp(`^${label}: `) }).first();
const rowValue = async (label) => ((await row(label).getAttribute("aria-label")) ?? "").replace(new RegExp(`^${label}: `), "").replace(/\. Change$/, "");
const btn = (name) => page.getByRole("button", { name, exact: true }).first();
try {
  await page.goto(`${BASE}/?demo`, { waitUntil: "load", timeout: 180000 });
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: /^Walk at lunch, no podcast/ }).first().click();
  await page.waitForTimeout(1500);
  ok("the task starts repeating on weekdays, reminding at the time", (await rowValue("Repeats")) === "Weekdays" && (await rowValue("Reminder")) === "At the time", `${await rowValue("Repeats")} / ${await rowValue("Reminder")}`);

  // Repeats has its own sheet.
  await row("Repeats").click();
  await page.waitForTimeout(1200);
  ok("Repeats opens its own sheet, not the reminder's", (await page.getByText("Every weekday", { exact: true }).count()) > 0 && (await page.getByText("How long before?").count()) === 0);
  await page.getByRole("radio", { name: "Every week", exact: true }).first().click();
  await btn("Set repeat").click();
  await page.waitForTimeout(1200);
  ok("the repeat changes on its own", (await rowValue("Repeats")) === "Weekly" && (await rowValue("Reminder")) === "At the time");

  // The reminder: just this time.
  await row("Reminder").click();
  await page.waitForTimeout(1200);
  ok("the reminder sheet has no repeat chips any more", (await page.getByText("Never", { exact: true }).count()) === 0);
  ok("…and asks whether to remind each time or just this time", (await page.getByText("Just this time", { exact: true }).count()) > 0);
  await page.getByText("Just this time", { exact: true }).first().click();
  await page.waitForTimeout(300);
  ok("its sentence says this time only", (await page.evaluate(() => document.body.innerText)).includes("this time only"));
  await btn("Set reminder").click();
  await page.waitForTimeout(1200);
  ok("the task shows a reminder for this time", (await rowValue("Reminder")) === "At the time, this time", await rowValue("Reminder"));

  // Ticked off: it comes back, without that reminder, still repeating.
  await page.getByRole("checkbox", { name: "Mark done" }).first().click();
  await page.waitForTimeout(1800);
  ok("ticked off, it comes back without the reminder", (await rowValue("Reminder")) === "Off", await rowValue("Reminder"));
  ok("…and still repeats weekly", (await rowValue("Repeats")) === "Weekly");

  // A reminder each time; then "No reminder" leaves the repeat alone.
  await row("Reminder").click();
  await page.waitForTimeout(1200);
  await btn("Set reminder").click();
  await page.waitForTimeout(1200);
  ok("a reminder for each time", (await rowValue("Reminder")) === "At the time");
  await row("Reminder").click();
  await page.waitForTimeout(1200);
  await btn("No reminder").click();
  await page.waitForTimeout(1200);
  ok("No reminder takes the reminder only: it still repeats", (await rowValue("Reminder")) === "Off" && (await rowValue("Repeats")) === "Weekly");
} catch (error) {
  failures++;
  console.log("FAIL the run stopped:", error.message.split("\n").slice(0, 3).join(" | "));
  await page.screenshot({ path: "/root/projects/clarity-design-research/revamp-5/shots/editor/repeat-stopped.png" }).catch(() => {});
} finally {
  ok("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}
