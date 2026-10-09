// Photos in notes, in Sage's web build, demo mode: the Photo tool while
// writing, a photo chosen from a file (the web build's library), shrunk and
// kept in the browser (src/editor/photoStore.web.ts), shown in the note on a
// line of its own with the cursor under it, and still there when the note is
// opened again. Demo mode must send nothing.
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

const BASE = process.env.BASE || "http://localhost:8087";
const OUT = process.env.OUT || "/root/projects/clarity-design-research/revamp-5/shots/photos";
mkdirSync(OUT, { recursive: true });
let failures = 0;
const ok = (name, pass, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${!pass && detail ? `  (${detail})` : ""}`);
};

/** A plain PNG of the given size, standing in for a photo from the phone. */
function png(width, height) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) raw.set([200, (80 + Math.floor((y / height) * 120)) & 255, 70], row + 1 + x * 3);
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const files = mkdtempSync(join(tmpdir(), "sage-photos-"));
const LARGE = join(files, "large.png");
writeFileSync(LARGE, png(3000, 2000));

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/opt/google/chrome/chrome",
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--renderer-process-limit=1", "--disable-extensions"],
});
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
const api = [];
const failed = [];
// Signing in isn't needed in demo mode, and may not be reachable (a machine
// without the real key, or offline): its errors, and things from elsewhere
// that don't load, aren't the app's. What the app serves itself must load.
const notTheApps = (text) => /clerk/i.test(text) || /^Failed to load resource/.test(text);
page.on("pageerror", (e) => { if (!notTheApps(e.message)) errors.push(e.message); });
page.on("console", (m) => { if (m.type() === "error" && !notTheApps(m.text())) errors.push(m.text().slice(0, 200)); });
// (A request the app cancels itself, net::ERR_ABORTED, isn't a failure to load.)
page.on("requestfailed", (r) => { if (r.url().startsWith(BASE) && r.failure()?.errorText !== "net::ERR_ABORTED") failed.push(r.url()); });
page.on("request", (r) => { if (r.url().includes("/_api/")) api.push(r.url()); });

const btn = (name) => page.getByRole("button", { name, exact: false }).first();
const editorFrame = () => page.frames().filter((frame) => frame.url() === "about:srcdoc" && !frame.isDetached()).at(-1);
const waitEditor = async () => {
  await page.waitForFunction(() => document.querySelector('iframe[title="Note"]')?.contentDocument?.querySelector(".ProseMirror"), null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  return editorFrame();
};
const photos = (frame) =>
  frame.evaluate(() =>
    [...document.querySelectorAll(".ProseMirror .photo")].map((el) => {
      const img = el.querySelector("img");
      return { drawn: el.classList.contains("drawn"), src: img?.getAttribute("src")?.slice(0, 22) ?? null, width: img?.naturalWidth ?? 0, height: img?.naturalHeight ?? 0 };
    }),
  );
const markdown = (frame) => frame.evaluate(() => document.querySelector(".ProseMirror").editor.getMarkdown().replace(/\n+$/, ""));

try {
  // The samples live only as long as the page: everything below moves by taps.
  await page.goto(`${BASE}/notes?demo`, { waitUntil: "load", timeout: 180000 });
  await page.getByRole("button", { name: /^Slow morning/ }).first().waitFor({ timeout: 60000 });

  // 1. Writing in a sample note, the tools row has Photo, after Link.
  await page.getByRole("button", { name: /^Slow morning/ }).first().click();
  let frame = await waitEditor();
  await frame.locator(".ProseMirror p").first().click();
  await frame.evaluate(() => {
    const editor = document.querySelector(".ProseMirror").editor;
    let end = null;
    editor.state.doc.descendants((node, pos) => {
      if (end === null && node.type.name === "paragraph" && node.textContent) end = pos + node.nodeSize - 1;
    });
    editor.chain().focus().setTextSelection(end).run();
  });
  await page.waitForTimeout(400);
  const toolOrder = await page.getByTestId("note-tools").evaluate((tools) => [...tools.querySelectorAll('[role="button"]')].map((el) => el.getAttribute("aria-label")));
  ok("writing, the tools row has Photo, after Link", toolOrder.indexOf("Photo") === toolOrder.indexOf("Link") + 1, toolOrder.join(", "));
  const before = await markdown(frame);

  // 2. Photo: a file is chosen; it's shrunk, kept, and put on a line of its own after the cursor's line.
  const chooser = page.waitForEvent("filechooser", { timeout: 15000 });
  await btn("Photo").click();
  await (await chooser).setFiles(LARGE);
  await frame.waitForFunction(() => document.querySelector(".ProseMirror .photo.drawn"), null, { timeout: 20000 });
  let shown = await photos(frame);
  ok("the chosen photo is in the note, drawn", shown.length === 1 && shown[0].drawn, JSON.stringify(shown));
  ok("…kept as a JPEG", shown[0]?.src === "data:image/jpeg;base64", shown[0]?.src);
  ok("…shrunk to 2048 on its longer side", shown[0]?.width === 2048 && shown[0]?.height === 1365, `${shown[0]?.width}x${shown[0]?.height}`);
  await page.keyboard.type("Under the photo.", { delay: 10 });
  await page.waitForTimeout(500);
  const after = await markdown(frame);
  const id = after.match(/!\[\]\(attachment:([0-9a-f-]{36})\)/)?.[1];
  ok("the note names it by id, and the cursor was under it", !!id && after.includes(`![](attachment:${id})\n\nUnder the photo.`), after.slice(0, 200));
  ok("…after the line the cursor was in, the rest as it was", after.replace(`\n\n![](attachment:${id})\n\nUnder the photo.`, "") === before, after.slice(0, 300));
  ok("the photo is kept in the browser", await page.evaluate((key) => new Promise((resolve) => {
    const request = indexedDB.open("clarity-photos");
    request.onsuccess = () => {
      const get = request.result.transaction("photos").objectStore("photos").get(key);
      get.onsuccess = () => resolve(typeof get.result === "string" && get.result.startsWith("data:image/jpeg;base64,"));
      get.onerror = () => resolve(false);
    };
    request.onerror = () => resolve(false);
  }), id));
  await page.screenshot({ path: `${OUT}/note-with-photo.png` });

  // 3. Left and opened again: the photo is still there.
  await btn("Put the keyboard away").click();
  await page.waitForTimeout(500);
  await btn("Done").click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /^Slow morning/ }).first().click();
  frame = await waitEditor();
  shown = await photos(frame);
  ok("opened again, the photo is there", shown.length === 1 && shown[0].drawn, JSON.stringify(shown));
  ok("…with the words under it", (await markdown(frame)).includes(`![](attachment:${id})\n\nUnder the photo.`));
  await page.screenshot({ path: `${OUT}/note-reopened.png` });
} catch (error) {
  failures++;
  console.log("FAIL the run stopped:", error.message.split("\n").slice(0, 4).join(" | "));
  await page.screenshot({ path: `${OUT}/stopped.png` }).catch(() => {});
} finally {
  ok("demo mode sent nothing to the server", api.length === 0, api.slice(0, 3).join(", "));
  ok("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  ok("everything the app serves loaded", failed.length === 0, failed.slice(0, 3).join(", "));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}
