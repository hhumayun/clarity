// The note editor's tests: the main app's (tests/note-editor at 4344bd8), run
// against revamp 5's built editor page. The page is the string in
// src/editor/page.ts, exactly what the app loads, opened in desktop Chrome and
// driven the way the note page drives it on the phone: the look and the note
// go in through `clarityEditor.receive`, commands too, and what the page sends
// back (src/editor/protocol.ts) is captured. Only this harness and the checks
// on questions differ from the main app's; see README.md.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");

// The page as the app ships it, written out to open in Chrome.
const PAGE_TS = path.resolve(__dirname, "../../src/editor/page.ts");
const source = fs.readFileSync(PAGE_TS, "utf8");
const pageHtml = JSON.parse(source.slice(source.indexOf("= ") + 2, source.lastIndexOf(";")));
const PAGE_FILE = path.join(os.tmpdir(), "sage-editor-page.html");
fs.writeFileSync(PAGE_FILE, pageHtml);
const PAGE = `file://${PAGE_FILE}`;

// The main app's test settings (18/28 type, 16-point sides, two lines of room
// under the last line), as Sage's look.
const LOOK = {
  placeholder: "Start writing…",
  colors: { card: "#ffffff", ink: "#222222", ink2: "#555555", ink3: "#888888", line: "#dddddd", sunken: "#eeeeee", accent: "#22aa77", onAccent: "#ffffff", accentText: "#22aa77" },
  body: { size: 18, lineHeight: 28 },
  question: { size: 18, lineHeight: 25 },
  padding: { top: 12, side: 16, bottom: 56 },
};

// `photos`, when given, is the app's side of photos: `sources` by id (an id
// not in it is answered null: not on this phone), sent `delay` ms after the
// page asks. Each answer is noted in the messages as { type: "answered" }.
async function open(browser, markdown, doc = null, photos = null) {
  const page = await browser.newPage({ viewport: { width: 390, height: 700 } });
  page.on("pageerror", (e) => console.log("  PAGE ERROR:", e.message));
  await page.addInitScript(([md, seedDoc, look, photoAnswers]) => {
    window.__msgs = [];
    // What the page says, in the shape the main app's checks read
    // ({ data: { actionId, args } }), so they stay as they were.
    const shape = {
      change: (m) => ["onChange", [m.markdown, m.doc, m.at]],
      formats: (m) => ["onState", [m.formats]],
      cursor: (m) => ["onCursor", [m.cursor]],
      focus: (m) => ["onFocusChange", [m.focused]],
      shown: () => ["onReady", []],
    };
    window.ReactNativeWebView = {
      postMessage: (raw) => {
        const msg = JSON.parse(raw);
        if (shape[msg.type]) {
          const [actionId, args] = shape[msg.type](msg);
          window.__msgs.push({ data: { actionId, args } });
        } else {
          window.__msgs.push(msg);
        }
        // The note page: once the editor is up, the look, then the note.
        if (msg.type === "ready") {
          setTimeout(() => {
            window.clarityEditor.receive({ type: "look", look });
            window.clarityEditor.receive({ type: "seed", seed: "1", markdown: md, doc: seedDoc, focus: null });
          });
        }
        if (msg.type === "needPhotos" && photoAnswers) {
          setTimeout(() => {
            const sources = Object.fromEntries(msg.ids.map((id) => [id, photoAnswers.sources[id] ?? null]));
            window.__msgs.push({ type: "answered", ids: msg.ids });
            window.clarityEditor.receive({ type: "photos", sources });
          }, photoAnswers.delay ?? 0);
        }
      },
    };
    window._domRefProxy = { run: (name, value) => window.clarityEditor.receive({ type: "run", name, value: value ?? undefined }) };
  }, [markdown, doc, LOOK, photos]);
  await page.goto(PAGE, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(
    () => window.__msgs.some((m) => m.data && m.data.actionId === "onReady") && window._domRefProxy,
    null,
    { timeout: 60000 },
  );
  return page;
}

const calls = (page, id) =>
  page.evaluate((a) => window.__msgs.filter((m) => m.data && m.data.actionId === a).map((m) => m.data.args[0]), id);
const last = async (page, id) => (await calls(page, id)).at(-1);
const lastDoc = (page) =>
  page.evaluate(() => window.__msgs.filter((m) => m.data && m.data.actionId === "onChange").map((m) => m.data.args[1]).at(-1));
const run = (page, ...args) => page.evaluate((a) => window._domRefProxy.run(...a), args);
const html = (page) => page.evaluate(() => document.querySelector(".ProseMirror").innerHTML);
const pause = (page, ms = 450) => page.waitForTimeout(ms);
const type = (page, text) => page.keyboard.type(text, { delay: 5 });

let failures = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) console.log("  got: ", JSON.stringify(got), "\n  want:", JSON.stringify(want));
}

(async () => {
  // Chrome: the one at CHROME_PATH, or the installed Google Chrome.
  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }),
    args: ["--no-sandbox"],
  });
  try {
    // 1. A note written before rich text: its lines and its numbered list.
    const plain = "Weekend plan\nWhat needs doing before Monday ?\n1. Buy groceries\n2. Fix the bike\n\nThen rest.";
    let page = await open(browser, plain);
    const h1 = await html(page);
    check("plain note keeps its lines (line breaks)", /Weekend plan<br[^>]*>What needs/.test(h1), true);
    check("plain note's 1. 2. become a numbered list", /<ol[^>]*>.*Buy groceries.*Fix the bike.*<\/ol>/.test(h1), true);
    check("nothing reported before any edit", (await calls(page, "onChange")).length, 0);
    await page.click(".ProseMirror");
    await page.keyboard.press("Control+End");
    await type(page, " Done.");
    await pause(page);
    check(
      "plain note round trip (a blank line before the list is the only change)",
      await last(page, "onChange"),
      plain.replace("Monday ?\n1.", "Monday ?\n\n1.") + " Done.",
    );
    await page.close();

    // 2. A checklist that indents, and ticking an item.
    page = await open(browser, "");
    await page.click(".ProseMirror");
    await run(page, "task");
    await type(page, "milk");
    await page.keyboard.press("Enter");
    await type(page, "eggs");
    await run(page, "indent");
    await page.keyboard.press("Enter");
    await type(page, "bread");
    await run(page, "outdent");
    await pause(page);
    check("checklist with an indented item", await last(page, "onChange"), "- [ ] milk\n  - [ ] eggs\n- [ ] bread");
    await page.locator('ul[data-type="taskList"] input[type="checkbox"]').first().click();
    await pause(page);
    check("ticking an item", (await last(page, "onChange")).startsWith("- [x] milk"), true);
    await page.close();

    // 3. Heading, bold, bullets that nest, a line break.
    page = await open(browser, "");
    await page.click(".ProseMirror");
    await run(page, "heading");
    await type(page, "Plan");
    await page.keyboard.press("Enter");
    await type(page, "Some ");
    await run(page, "bold");
    await type(page, "bold");
    await run(page, "bold");
    await type(page, " words.");
    await page.keyboard.press("Shift+Enter");
    await type(page, "Next line.");
    await page.keyboard.press("Enter");
    await run(page, "bullet");
    await type(page, "one");
    await page.keyboard.press("Enter");
    await type(page, "two");
    await run(page, "indent");
    await pause(page);
    check(
      "heading, bold, line break, nested bullets",
      await last(page, "onChange"),
      "## Plan\n\nSome **bold** words.\nNext line.\n\n- one\n  - two",
    );
    const state = await last(page, "onState");
    check("toolbar state reports the list", state && state.bullet, true);
    await page.close();

    // 4. Links: on chosen words, and a new one at the cursor.
    page = await open(browser, "");
    await page.click(".ProseMirror");
    await type(page, "see the site");
    await page.keyboard.down("Shift");
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowLeft");
    await page.keyboard.up("Shift");
    await pause(page, 150);
    await run(page, "link", "https://example.com");
    // (Home and End are unreliable in headless Chrome: the cursor is placed directly.)
    await page.evaluate(() => document.querySelector(".ProseMirror").editor.commands.focus("end"));
    await type(page, " or ");
    await run(page, "link", "https://clarity.app");
    await pause(page);
    check(
      "links",
      await last(page, "onChange"),
      "see the [site](https://example.com) or [https://clarity.app](https://clarity.app) ",
    );
    await type(page, "after");
    await pause(page);
    check(
      "words typed after a new link are not part of it",
      await last(page, "onChange"),
      "see the [site](https://example.com) or [https://clarity.app](https://clarity.app) after",
    );
    await page.close();

    // 5. Suggestions and questions, as the tray puts them in.
    page = await open(browser, "");
    await page.click(".ProseMirror");
    await type(page, "It was good   ");
    await run(page, "insertText", JSON.stringify({ text: ". Then I left ", trimBefore: true }));
    await pause(page);
    check("suggestion ends the sentence first", await last(page, "onChange"), "It was good. Then I left ");
    const cursor = await last(page, "onCursor");
    check("cursor reported to the app", cursor && cursor.before.endsWith("Then I left "), true);
    await run(page, "insertQuestion", JSON.stringify({ text: "What went well?" }));
    await type(page, "The talk");
    await pause(page);
    check("question as a quote on its own line, answer under it", await last(page, "onChange"), "It was good. Then I left \n\n> What went well?\n\nThe talk");
    await page.close();
    // 6. Indenting a line that is not in a list.
    const N4 = "\u00a0".repeat(4);
    page = await open(browser, "");
    await page.click(".ProseMirror");
    await type(page, "Top");
    await page.keyboard.press("Enter");
    await type(page, "Inner");
    await run(page, "indent");
    await pause(page);
    check("indent a plain line", await last(page, "onChange"), `Top\n\n${N4}Inner`);
    check("indented line drawn indented", await page.locator('p[data-indent="1"]').count(), 1);
    await run(page, "indent");
    await pause(page);
    check("indent again", await last(page, "onChange"), `Top\n\n${N4}${N4}Inner`);
    await run(page, "outdent");
    await pause(page);
    check("outdent", await last(page, "onChange"), `Top\n\n${N4}Inner`);
    await page.evaluate(() => {
      const editor = document.querySelector(".ProseMirror").editor;
      let at = null;
      editor.state.doc.descendants((node, pos) => {
        if (at === null && node.isTextblock && node.textContent === "Inner") at = pos + 1;
      });
      editor.commands.setTextSelection(at);
    });
    await page.keyboard.press("Backspace");
    await pause(page);
    check("backspace at the line's start steps it out", await last(page, "onChange"), "Top\n\nInner");
    await page.close();

    // 7. An indented note opens indented, and keeps its indent when edited.
    page = await open(browser, `Top\n\n${N4}Inner **bold** words`);
    check("indent read back from the saved text", await page.locator('p[data-indent="1"]').count(), 1);
    check("the indent's spaces are not in the words", await page.locator('p[data-indent="1"]').textContent(), "Inner bold words");
    await page.click(".ProseMirror");
    await page.keyboard.press("Control+End");
    await type(page, " x");
    await pause(page);
    check("indented note round trip", await last(page, "onChange"), `Top\n\n${N4}Inner **bold** words x`);
    await page.close();

    // 8. Headings indent too: in the rich text (Markdown cannot hold it).
    page = await open(browser, "");
    await page.click(".ProseMirror");
    await run(page, "heading");
    await type(page, "Title");
    await run(page, "indent");
    await pause(page);
    check("indented heading's Markdown stays a heading", await last(page, "onChange"), "## Title");
    const headingDoc = await lastDoc(page);
    check("indented heading kept in the rich text", headingDoc.content[0].attrs.indent, 1);
    await page.close();
    page = await open(browser, "## Title", headingDoc);
    check("note opened from its rich text: heading indented", await page.locator('h2[data-indent="1"]').count(), 1);
    await page.close();

    // 10. The first item of a list takes the whole list in, and back out.
    page = await open(browser, "");
    await page.click(".ProseMirror");
    await run(page, "bullet");
    await type(page, "first");
    await run(page, "indent");
    await pause(page);
    check("first item: the list moves in", (await lastDoc(page)).content[0].attrs.indent, 1);
    check("list drawn indented", await page.locator('ul[data-indent="1"]').count(), 1);
    await run(page, "outdent");
    await pause(page);
    check("outdent brings the list back first", (await lastDoc(page)).content[0].attrs.indent, 0);
    check("…still a list", (await lastDoc(page)).content[0].type, "bulletList");
    await page.close();

    // 11. Backspace at the start of a list item: only that item's checkbox
    // or number goes. By the key, and by iOS's own deletion (a beforeinput
    // with no key press), which is what broke on the phone.
    const toLineStart = async (pg, text) => {
      for (let i = 0; i < text.length; i++) await pg.keyboard.press("ArrowLeft");
      await pause(pg, 80);
    };
    const iosBackspace = (pg) =>
      pg.evaluate(() =>
        document
          .querySelector(".ProseMirror")
          .dispatchEvent(new InputEvent("beforeinput", { inputType: "deleteContentBackward", bubbles: true, cancelable: true })),
      );
    for (const [kind, one, two] of [["task", "- [ ] one", "two"], ["ordered", "1. one", "two"]]) {
      for (const how of ["key", "ios"]) {
        page = await open(browser, "");
        await page.click(".ProseMirror");
        await run(page, kind);
        await type(page, "one");
        await page.keyboard.press("Enter");
        await type(page, "two");
        await toLineStart(page, "two");
        if (how === "key") await page.keyboard.press("Backspace");
        else await iosBackspace(page);
        await pause(page);
        check(`${kind}: backspace (${how}) takes off only that item's marker`, await last(page, "onChange"), `${one}\n\n${two}`);
        await page.close();
      }
    }

    // A middle item: the list splits, and the items either side keep theirs.
    page = await open(browser, "");
    await page.click(".ProseMirror");
    await run(page, "task");
    for (const [i, word] of ["one", "two", "three"].entries()) {
      if (i) await page.keyboard.press("Enter");
      await type(page, word);
    }
    // Up into "two" first (End may not move it here; toLineStart places the
    // cursor itself, but the test needs the cursor to have left "three").
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("End");
    await toLineStart(page, "two");
    await iosBackspace(page);
    await pause(page);
    check("middle item: only it loses its checkbox", await last(page, "onChange"), "- [ ] one\n\ntwo\n\n- [ ] three");
    await page.close();

    // A nested item steps out a level instead.
    page = await open(browser, "");
    await page.click(".ProseMirror");
    await run(page, "task");
    await type(page, "one");
    await page.keyboard.press("Enter");
    await type(page, "two");
    await run(page, "indent");
    await toLineStart(page, "two");
    await page.keyboard.press("Backspace");
    await pause(page);
    check("nested item: backspace steps it out a level", await last(page, "onChange"), "- [ ] one\n- [ ] two");
    await page.close();

    // The iPhone case: backspacing through "two" reopens the word for
    // autocorrect (a composition), during which ProseMirror ignores keys. The
    // Backspace on the emptied item must still take off only its marker.
    for (const [kind, one] of [["task", "- [ ] one"], ["ordered", "1. one"]]) {
      page = await open(browser, "");
      await page.click(".ProseMirror");
      await run(page, kind);
      await type(page, "one");
      await page.keyboard.press("Enter");
      await type(page, "two");
      for (let i = 0; i < 3; i++) await page.keyboard.press("Backspace");
      await pause(page, 80);
      await page.evaluate(() => {
        document.querySelector(".ProseMirror").editor.view.input.composing = true;
      });
      await page.keyboard.press("Backspace");
      await page.evaluate(() => {
        document.querySelector(".ProseMirror").editor.view.input.composing = false;
      });
      await pause(page);
      check(`${kind}: emptied item while composing keeps the line above`, (await last(page, "onChange")).startsWith(one), true);
      await type(page, "x");
      await pause(page);
      check(`${kind}: the emptied line went; the cursor is at the end of the line above`, await last(page, "onChange"), `${one}x`);
      await page.close();
    }

    // Enter at the end of an item, then Backspace on the new empty one, in
    // each kind of list; and a second line inside an item joins the first.
    for (const [kind, one] of [["bullet", "- one"], ["ordered", "1. one"], ["task", "- [ ] one"]]) {
      page = await open(browser, "");
      await page.click(".ProseMirror");
      await run(page, kind);
      await type(page, "one");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Backspace");
      await pause(page);
      check(`${kind}: backspace on a new empty item deletes it, keeps the one above`, await last(page, "onChange"), one);
      await type(page, "!");
      await pause(page);
      check(`${kind}: …and the cursor is at the end of the item above`, await last(page, "onChange"), `${one}!`);
      await page.close();
    }
    page = await open(browser, "- one\n\n  two");
    check("an item with a second line", (await page.locator("li > p").count()) >= 2, true);
    await page.click(".ProseMirror");
    // The cursor just before "two" (Tiptap keeps an empty line after a list,
    // so the end of the note is past it).
    await page.evaluate(() => {
      const editor = document.querySelector(".ProseMirror").editor;
      let at = null;
      editor.state.doc.descendants((node, pos) => {
        if (at === null && node.isText && node.text === "two") at = pos;
      });
      editor.commands.setTextSelection(at);
    });
    await page.keyboard.press("Backspace");
    await pause(page);
    check("backspace at an item's second line joins it to the first", await last(page, "onChange"), "- onetwo");
    await page.close();

    // An emptied last item: no "&nbsp;" left in the Markdown, and a second
    // Backspace goes back to the end of the item above.
    page = await open(browser, "");
    await page.click(".ProseMirror");
    await run(page, "task");
    await type(page, "one");
    await page.keyboard.press("Enter");
    await type(page, "two");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Backspace");
    await pause(page);
    check("emptied item leaves clean Markdown", await last(page, "onChange"), "- [ ] one\n- [ ] two");
    await type(page, "!");
    await pause(page);
    check("…and the cursor is at the end of the item above", await last(page, "onChange"), "- [ ] one\n- [ ] two!");
    await page.close();

    // 13. Under a ticked item: words are never pulled into it (they would be
    // struck through); an empty line still just goes.
    const setCaret = (pg, text, offset) =>
      pg.evaluate(([t, o]) => {
        const editor = document.querySelector(".ProseMirror").editor;
        let at = null;
        editor.state.doc.descendants((node, pos) => {
          if (at === null && node.isText && node.text === t) at = pos + o;
        });
        editor.chain().focus().setTextSelection(at).run();
      }, [text, offset]);
    page = await open(browser, "- [x] one\n- [ ] two");
    await setCaret(page, "two", 0);
    await pause(page, 200);
    await page.keyboard.press("Backspace");
    await pause(page);
    check("ticked above: first backspace takes off two's checkbox", await last(page, "onChange"), "- [x] one\n\ntwo");
    await page.keyboard.press("Backspace");
    await pause(page);
    const struck = await page.evaluate(() =>
      [...document.querySelectorAll(".ProseMirror p")].some(
        (p) => p.textContent.includes("two") && getComputedStyle(p.closest("li > div") || p).textDecorationLine.includes("line-through"),
      ),
    );
    check("ticked above: a second backspace does not pull 'two' into it", await last(page, "onChange"), "- [x] one\n\ntwo");
    check("ticked above: 'two' is not struck through", struck, false);
    await type(page, "!");
    await pause(page);
    check("ticked above: the cursor went to the end of the ticked line", await last(page, "onChange"), "- [x] one!\n\ntwo");
    await page.close();

    page = await open(browser, "- [x] one\n\ntwo");
    await setCaret(page, "two", 3);
    await pause(page, 200);
    for (let i = 0; i < 4; i++) await page.keyboard.press("Backspace");
    await type(page, "!");
    await pause(page);
    check("ticked above: an empty line under it just goes", await last(page, "onChange"), "- [x] one!");
    await page.close();

    // An empty row under a ticked one: only its checkbox goes, and the empty
    // line stays, so what is typed next is not put into the ticked line.
    page = await open(browser, "- [x] one");
    await setCaret(page, "one", 3);
    await pause(page, 200);
    await page.keyboard.press("Enter");
    await pause(page);
    check("enter on a ticked row makes an unticked one", await last(page, "onChange"), "- [x] one\n- [ ] ");
    await page.keyboard.press("Backspace");
    await pause(page);
    await type(page, "two");
    await pause(page);
    check("ticked above: deleting an empty row keeps a plain line", await last(page, "onChange"), "- [x] one\n\ntwo");
    const twoStruck = await page.evaluate(() =>
      [...document.querySelectorAll(".ProseMirror p")].some(
        (p) => p.textContent.includes("two") && getComputedStyle(p.closest("li > div") || p).textDecorationLine.includes("line-through"),
      ),
    );
    check("ticked above: what is typed there is not struck through", twoStruck, false);
    await page.close();

    // However an empty ticked row comes about (iOS can copy the row it was
    // made from), it is unticked.
    page = await open(browser, "- [x] one\n- [ ] two");
    await page.evaluate(() => {
      const editor = document.querySelector(".ProseMirror").editor;
      const { state } = editor;
      const list = state.doc.firstChild;
      const item = state.schema.nodes.taskItem.create({ checked: true }, state.schema.nodes.paragraph.create());
      editor.view.dispatch(state.tr.insert(1 + list.child(0).nodeSize, item));
    });
    await pause(page);
    const ticks = await page.evaluate(() => {
      const ticks = [];
      document.querySelector(".ProseMirror").editor.state.doc.descendants((node) => {
        if (node.type.name === "taskItem") ticks.push(node.attrs.checked);
      });
      return ticks;
    });
    check("an empty row made ticked is unticked", JSON.stringify(ticks), JSON.stringify([true, false, false]));
    await page.close();

    // One press, one action: iOS can follow a Backspace the editor took with
    // its own deletion for the same press. Only the first is acted on.
    page = await open(browser, "- [ ] one\n- [ ] two");
    await setCaret(page, "two", 0);
    await pause(page, 200);
    await page.evaluate(() => {
      const el = document.querySelector(".ProseMirror");
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", code: "Backspace", bubbles: true, cancelable: true }));
      el.dispatchEvent(new InputEvent("beforeinput", { inputType: "deleteContentBackward", bubbles: true, cancelable: true }));
    });
    await pause(page);
    check("one press with iOS's own deletion after it: one action", await last(page, "onChange"), "- [ ] one\n\ntwo");
    await page.close();

    // 12. Rows: a checklist row is exactly one line tall, and taking the
    // checkbox off a line with words moves nothing below it.
    page = await open(browser, "- [ ] one\n- [ ] two\n\nText below");
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('ul[data-type="taskList"] > li')].map((li) => Math.round(li.getBoundingClientRect().height)),
    );
    check("checklist rows are one line (28) tall", JSON.stringify(rows), JSON.stringify([28, 28]));
    const belowTop = () =>
      page.evaluate(() => [...document.querySelectorAll(".ProseMirror p")].find((p) => p.textContent === "Text below").getBoundingClientRect().top);
    const topBefore = await belowTop();
    await setCaret(page, "two", 0);
    await pause(page, 120);
    await page.keyboard.press("Backspace");
    await pause(page);
    check("taking a checkbox off keeps the words", await last(page, "onChange"), "- [ ] one\n\ntwo\n\nText below");
    check("…and the text below does not move", Math.round((await belowTop()) - topBefore), 0);
    await page.close();

    // 15. Changes go to the app in batches: once typing pauses, at least
    // every second while it doesn't, and at once when asked (leaving the
    // note), when the keyboard closes, or when the page is hidden.
    page = await open(browser, "Start");
    await page.click(".ProseMirror");
    await page.evaluate(() => document.querySelector(".ProseMirror").editor.commands.focus("end"));
    const sentBefore = (await calls(page, "onChange")).length;
    await page.keyboard.type(" one two three", { delay: 20 });
    await pause(page);
    const sent = (await calls(page, "onChange")).length - sentBefore;
    check("typing a few words sends one or two changes, not one per key", sent >= 1 && sent <= 2, true);
    check("…and the last one has every word", await last(page, "onChange"), "Start one two three");
    await page.keyboard.type(" four", { delay: 5 });
    await run(page, "flush");
    await page.waitForTimeout(30);
    check("asked to (leaving the note), it sends at once", await last(page, "onChange"), "Start one two three four");
    await page.keyboard.type(" five", { delay: 5 });
    await page.evaluate(() => document.querySelector(".ProseMirror").editor.commands.blur());
    await page.waitForTimeout(30);
    check("the keyboard closing sends at once", await last(page, "onChange"), "Start one two three four five");
    const stamp = await page.evaluate(() =>
      window.__msgs.filter((m) => m.data && m.data.actionId === "onChange").map((m) => m.data.args[2]).at(-1),
    );
    check("each change says when it left (for the timing log)", typeof stamp === "number" && Math.abs(Date.now() - stamp) < 60_000, true);
    await page.close();

    // Words not yet sent are newer than any copy the app sends meanwhile
    // (the server's, arriving just as typing starts): they stay.
    page = await open(browser, "Old");
    await page.click(".ProseMirror");
    await page.evaluate(() => document.querySelector(".ProseMirror").editor.commands.focus("end"));
    await page.keyboard.type(" mine", { delay: 5 });
    await page.evaluate(() =>
      window.clarityEditor.receive({ type: "seed", seed: "2", markdown: "Server copy", doc: null, focus: null }),
    );
    await pause(page);
    check("a copy arriving while words are unsent does not replace them", await last(page, "onChange"), "Old mine");
    check("…and the page still has them", await page.evaluate(() => document.querySelector(".ProseMirror").textContent), "Old mine");
    await page.close();

    // 16. Quotes: Backspace keeps working after the editor has moved the
    // cursor. (Tiptap's own quote rule left a cursor the editor did not
    // recognise, and every Backspace after it did nothing.)
    const quoteDoc = { type: "doc", content: [
      { type: "blockquote", content: [
        { type: "paragraph", content: [{ type: "text", text: "Quoted" }] },
        { type: "paragraph", content: [{ type: "text", text: "Last line" }] },
      ] },
      { type: "paragraph", content: [{ type: "text", text: "After" }] },
    ] };
    const shape = (pg) => pg.evaluate(() =>
      document.querySelector(".ProseMirror").editor.getJSON().content
        .map((n) => n.type === "blockquote" ? `quote[${n.content.map((p) => (p.content || []).map((t) => t.text).join("")).join("|")}]` : (n.content || []).map((t) => t.text).join(""))
        .join(" / "));
    const caretAt = (pg, text, where) => pg.evaluate(([t, w]) => {
      const editor = document.querySelector(".ProseMirror").editor;
      let at = null;
      editor.state.doc.descendants((node, pos) => {
        if (at === null && node.isTextblock && node.textContent === t) at = w === "end" ? pos + node.nodeSize - 1 : pos + 1;
      });
      editor.chain().focus().setTextSelection(at).run();
    }, [text, where]);

    page = await open(browser, "", quoteDoc);
    await page.click(".ProseMirror");
    await caretAt(page, "Last line", "end");
    await pause(page, 120);
    for (const key of ["Enter", "Enter", "Backspace", "Backspace", "Backspace"]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(80);
    }
    await pause(page);
    check("quote: an empty line under it goes in one Backspace, and Backspace keeps deleting", await shape(page), "quote[Quoted|Last li] / After");
    await page.close();

    page = await open(browser, "", quoteDoc);
    await page.click(".ProseMirror");
    await caretAt(page, "After", "start");
    await pause(page, 120);
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await pause(page);
    // (The editor keeps an empty line after a quote that ends the note.)
    check("quote: a line under it joins its last line, and Backspace keeps deleting", await shape(page), "quote[Quoted|Last linAfter] / ");
    await page.close();

    page = await open(browser, "", quoteDoc);
    await page.click(".ProseMirror");
    await caretAt(page, "Last line", "start");
    await pause(page, 120);
    await page.keyboard.press("Backspace");
    await pause(page);
    check("quote: Backspace at the start of a later line takes it out of the quote", await shape(page), "quote[Quoted] / Last line / After");
    // (Home and End are unreliable in headless Chrome: the cursor is placed directly.)
    await caretAt(page, "Last line", "end");
    await pause(page, 120);
    await page.keyboard.press("Backspace");
    await pause(page);
    check("…and Backspace still deletes there", await shape(page), "quote[Quoted] / Last lin / After");
    await page.close();

    // The iPhone sends Shift with Backspace whenever its keyboard is set to
    // capitalise (the start of every new line): the same rules apply.
    page = await open(browser, "- [ ] one\n- [ ] two");
    await setCaret(page, "two", 0);
    await pause(page, 200);
    await page.keyboard.press("Shift+Backspace");
    await pause(page);
    check("shift+backspace at an item's start takes off only its checkbox", await last(page, "onChange"), "- [ ] one\n\ntwo");
    await page.close();

    page = await open(browser, "- [x] one");
    await setCaret(page, "one", 3);
    await pause(page, 200);
    await page.keyboard.press("Enter");
    await pause(page, 120);
    await page.keyboard.press("Shift+Backspace");
    await pause(page, 120);
    await type(page, "two");
    await pause(page);
    check("shift+backspace on an empty row under a ticked one: a plain line, not the ticked one", await last(page, "onChange"), "- [x] one\n\ntwo");
    await page.close();

    // 9. Below the last line of a long note: about two lines of room, no more.
    page = await open(browser, Array.from({ length: 40 }, (_, i) => `Line ${i + 1}`).join("\n"));
    const room = await page.evaluate(() => {
      const pm = document.querySelector(".ProseMirror");
      const last = pm.lastElementChild.getBoundingClientRect().bottom + window.scrollY;
      return Math.round(document.scrollingElement.scrollHeight - last);
    });
    check("room under a long note's last line is about two lines", room <= 28 * 2 + 4, true);
    await page.close();

    // ---- Sage's own: questions are quotes ----

    // Go deeper: a question at the end of the note, wherever the cursor is.
    page = await open(browser, "First line\n\nSecond line");
    await page.click(".ProseMirror");
    await page.evaluate(() => document.querySelector(".ProseMirror").editor.commands.focus("start"));
    await run(page, "insertQuestion", JSON.stringify({ text: "Why does it matter?", atEnd: true }));
    await type(page, "Because");
    await pause(page);
    check("sage: a question at the end, answered under it", await last(page, "onChange"), "First line\n\nSecond line\n\n> Why does it matter?\n\nBecause");
    check("sage: the question is drawn as a quote", await page.locator(".ProseMirror blockquote").count(), 1);
    await page.close();

    // Next question on an empty line: the line becomes the question.
    page = await open(browser, "");
    await page.click(".ProseMirror");
    await run(page, "insertQuestion", JSON.stringify({ text: "What went well?" }));
    check("sage: under a new question, the hint says Write", await page.evaluate(() => document.querySelector(".ProseMirror blockquote + p").getAttribute("data-placeholder")), "Write");
    await type(page, "The talk");
    await run(page, "insertQuestion", JSON.stringify({ text: "What was hard?" }));
    await type(page, "Leaving");
    await pause(page);
    check("sage: two questions, each answered, no stray blank lines", await last(page, "onChange"), "> What went well?\n\nThe talk\n\n> What was hard?\n\nLeaving");
    await page.close();

    // Today's question: the page opens with its question and the cursor under it.
    page = await open(browser, "");
    await page.evaluate(() =>
      window.clarityEditor.receive({
        type: "seed",
        seed: "today",
        markdown: "> What would make today good?",
        doc: { type: "doc", content: [{ type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "What would make today good?" }] }] }, { type: "paragraph" }] },
        focus: "end",
      }),
    );
    // A later copy cross-fades in (about a third of a second): typing starts once it's there.
    await page.waitForFunction(() => document.querySelector(".ProseMirror blockquote") && document.activeElement?.classList.contains("ProseMirror"), null, { timeout: 5000 });
    await pause(page, 250);
    await type(page, "A long walk");
    await pause(page);
    check("sage: today's page opens with the cursor under its question", await last(page, "onChange"), "> What would make today good?\n\nA long walk");
    await page.close();

    // The look: Sage's sizes and colours arrive with it.
    page = await open(browser, "> A question\n\nAn answer");
    const looks = await page.evaluate(() => {
      const quote = getComputedStyle(document.querySelector(".ProseMirror blockquote"));
      const body = getComputedStyle(document.querySelector(".ProseMirror"));
      return { body: body.fontSize, quoteWeight: quote.fontWeight, quoteColour: quote.color };
    });
    check("sage: body at the look's size", looks.body, "18px");
    check("sage: questions in semibold, in the accent", `${looks.quoteWeight} ${looks.quoteColour}`, "600 rgb(34, 170, 119)");
    await page.close();

    // Opening a note without a jolt (2026-10-06): "shown" waits for Sage's
    // face, and a new look never sets the faces up again.
    page = await browser.newPage({ viewport: { width: 390, height: 700 } });
    await page.addInitScript((look) => {
      window.__faceAtShown = null;
      window.ReactNativeWebView = {
        postMessage: (raw) => {
          const msg = JSON.parse(raw);
          if (msg.type === "ready") {
            setTimeout(() => {
              window.clarityEditor.receive({ type: "look", look });
              window.clarityEditor.receive({ type: "seed", seed: "1", markdown: "Words in Sage's face.", doc: null, focus: null });
            });
          }
          if (msg.type === "shown") window.__faceAtShown = document.fonts.check("17px Sage") && document.fonts.check("600 17px Sage");
        },
      };
    }, LOOK);
    await page.goto(PAGE, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__faceAtShown !== null, null, { timeout: 20000 });
    check("sage: shown only once Sage's face is loaded", await page.evaluate(() => window.__faceAtShown), true);
    const faceRules = () => page.evaluate(() => [...document.querySelectorAll("style")].filter((el) => el.textContent.includes("@font-face")).length);
    const facesBefore = await faceRules();
    await page.evaluate((look) => window.clarityEditor.receive({ type: "look", look: { ...look, body: { size: 20, lineHeight: 30 } } }), LOOK);
    check("sage: a new look leaves the faces as they were (one set, not loaded again)", `${facesBefore} ${await faceRules()}`, "1 1");
    check("sage: …and still takes effect", await page.evaluate(() => getComputedStyle(document.querySelector(".ProseMirror")).fontSize), "20px");
    await page.close();

    // Writing (UX phase 3, 2026-10-06): a tick is told to the app (for the haptic) and pops;
    // a question added comes down into place; a later copy cross-fades in; the strip's inset is taken.
    page = await open(browser, "- [ ] milk\n- [ ] eggs");
    await page.click('ul[data-type="taskList"] input[type="checkbox"]');
    await pause(page, 120);
    const tickedSent = await page.evaluate(() => window.__msgs.filter((m) => m.type === "ticked").map((m) => m.on));
    check("sage: ticking a checklist row tells the app (for the haptic)", JSON.stringify(tickedSent), "[true]");
    check("sage: …and its check gives a little pop", await page.evaluate(() => document.querySelector('li[data-checked="true"] input').getAnimations().length > 0), true);
    await page.click(".ProseMirror");
    await page.keyboard.press("Control+End");
    const arriving = await page.evaluate(() => {
      window._domRefProxy.run("insertQuestion", JSON.stringify({ text: "What made today good?", atEnd: true }));
      return [...document.querySelectorAll("blockquote")].some((q) => q.classList.contains("arriving") || q.getAnimations().length > 0);
    });
    check("sage: a question added comes down into place", arriving, true);
    await run(page, "inset", "48");
    await pause(page, 200);
    check("sage: the strip's inset is taken without fuss", await page.evaluate(() => !!document.querySelector(".ProseMirror")), true);
    // Words typed here and not yet sent stay over any copy; once they've gone, a newer copy can come in.
    await pause(page, 1300);
    await page.evaluate(() => window.clarityEditor.receive({ type: "seed", seed: "2", markdown: "A newer copy.", doc: null, focus: null }));
    const mid = await page.evaluate(() => new Promise((r) => setTimeout(() => r(Number(getComputedStyle(document.querySelector(".ProseMirror")).opacity)), 60)));
    await pause(page, 500);
    check("sage: a later copy cross-fades in (dims, then shows)", mid < 1 && (await page.evaluate(() => document.querySelector(".ProseMirror").innerText.trim())) === "A newer copy.", true);
    // Typed into while it dims: the writer's words are newer, and stay.
    await page.click(".ProseMirror");
    await page.keyboard.press("Control+End");
    await page.evaluate(() => window.clarityEditor.receive({ type: "seed", seed: "3", markdown: "A third copy.", doc: null, focus: null }));
    await page.keyboard.type(" Mine", { delay: 5 });
    await pause(page, 700);
    check("sage: …and words typed while it dims stay (the copy doesn't replace them)", await page.evaluate(() => document.querySelector(".ProseMirror").innerText.trim()), "A newer copy. Mine");
    await page.close();

    // Word help's strip lies over the bottom of the words: with its inset, the words can scroll up
    // past it, and the line being typed at the end of a long note stays above it.
    page = await open(browser, Array.from({ length: 40 }, (_, i) => `Line ${i + 1}`).join("\n"));
    const roomUnder = () =>
      page.evaluate(() => {
        const pm = document.querySelector(".ProseMirror");
        return Math.round(document.scrollingElement.scrollHeight - (pm.lastElementChild.getBoundingClientRect().bottom + window.scrollY));
      });
    const roomBefore = await roomUnder();
    await page.click(".ProseMirror");
    await page.keyboard.press("Control+End");
    await run(page, "inset", "48");
    await pause(page, 400);
    check("sage: with the strip's inset, the words can scroll up past it", (await roomUnder()) - roomBefore, 48);
    for (const line of ["Typing on", "and on", "at the end"]) {
      await page.keyboard.press("Enter");
      await type(page, line);
    }
    await pause(page, 200);
    const caretClear = await page.evaluate(() => {
      const range = window.getSelection().getRangeAt(0).cloneRange();
      const box = range.getClientRects()[0] ?? range.startContainer.parentElement.getBoundingClientRect();
      return Math.round(window.innerHeight - box.bottom);
    });
    check("sage: …and the line being typed stays above it", caretClear >= 48, true);
    await run(page, "inset", "0");
    await pause(page, 200);
    check("sage: …and the room goes with it", await roomUnder(), roomBefore);
    await page.close();

    // Words from the strip are fitted here, against what's really typed: the app's idea of it can be
    // a moment behind (the cursor is reported once it rests), so a word begun just before the tap
    // isn't put in twice.
    const ANCHOR = "The light on the water was";
    const inserted = (p) => p.evaluate(() => window.__msgs.filter((m) => m.type === "inserted").at(-1));
    const text = (p) => p.evaluate(() => document.querySelector(".ProseMirror").innerText.replace(/\s+$/, ""));
    page = await open(browser, `${ANCHOR} so`);
    await page.click(".ProseMirror");
    await page.keyboard.press("Control+End");
    await run(page, "insertWords", JSON.stringify({ text: "so soft and golden", kind: "finish", anchor: ANCHOR }));
    await pause(page, 200);
    check("sage: words begun before the tap: only the rest goes in", await text(page), `${ANCHOR} so soft and golden`);
    check("sage: …and the app is told where they end", (await inserted(page))?.before.endsWith("so soft and golden "), true);
    await page.close();

    page = await open(browser, ANCHOR);
    await page.click(".ProseMirror");
    await page.keyboard.press("Control+End");
    await run(page, "insertWords", JSON.stringify({ text: "so soft and golden", kind: "finish", anchor: ANCHOR }));
    await pause(page, 200);
    check("sage: nothing begun: all of it, spaced", await text(page), `${ANCHOR} so soft and golden`);
    await type(page, "grey.");
    await run(page, "insertWords", JSON.stringify({ text: "Then we stopped", kind: "start", anchor: ANCHOR }));
    await pause(page, 200);
    check("sage: a start after a full stop typed since: spaced and capitalised", await text(page), `${ANCHOR} so soft and golden grey. Then we stopped`);
    await page.close();

    page = await open(browser, `${ANCHOR} so soft and golden`);
    await page.click(".ProseMirror");
    await page.keyboard.press("Control+End");
    await run(page, "insertWords", JSON.stringify({ text: "so soft and golden", kind: "finish", anchor: ANCHOR }));
    await pause(page, 200);
    check("sage: words typed out already before the tap: nothing more goes in", await text(page), `${ANCHOR} so soft and golden`);
    check("sage: …and the app is told so", (await inserted(page))?.length, 0);
    await page.close();

    // ---- Photos (2026-10-09): files kept on the phone, named in the note as ![](attachment:<id>) ----
    const PHOTO = "aaaa1111-2222-4333-8444-555566667777";
    const OTHER = "bbbb1111-2222-4333-8444-555566667777";
    // A stand-in photo of a given size.
    const picture = (w, h) =>
      "data:image/svg+xml," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><rect width='100%' height='100%' fill='#c84'/></svg>`);
    const photoState = (pg) =>
      pg.evaluate(() =>
        [...document.querySelectorAll(".ProseMirror .photo")].map((el) => {
          const img = el.querySelector("img");
          return { classes: el.className, shape: el.style.aspectRatio, src: img.getAttribute("src"), width: img.naturalWidth, outline: getComputedStyle(el).outlineStyle };
        }),
      );
    const asked = (pg) => pg.evaluate(() => window.__msgs.filter((m) => m.type === "needPhotos").flatMap((m) => m.ids));
    const tree = (pg) =>
      pg.evaluate(() => {
        const outline = (n) => (n.type === "text" || n.type === "hardBreak" ? n.type : n.content ? `${n.type}(${n.content.map(outline).join(",")})` : n.type);
        return document.querySelector(".ProseMirror").editor.getJSON().content.map(outline).join(" ");
      });

    // A note's photo: asked for by its id, drawn from what the app sends, and kept as written.
    page = await open(browser, `Before\n\n![](attachment:${PHOTO})\n\nAfter`, null, { sources: { [PHOTO]: picture(40, 30) } });
    check("photos: the page asks the app for a note's photo, by its id", JSON.stringify(await asked(page)), JSON.stringify([PHOTO]));
    let photos = await photoState(page);
    check("photos: …and draws it from what the app sends", photos.length === 1 && photos[0].classes.includes("drawn") ? photos[0].width : null, 40);
    check("photos: …at its own shape", photos[0].shape.startsWith("1.33"), true);
    await setCaret(page, "After", 5);
    await pause(page, 200);
    await type(page, " all");
    await pause(page);
    check("photos: a note's photo stays as written", await last(page, "onChange"), `Before\n\n![](attachment:${PHOTO})\n\nAfter all`);
    check("photos: …and its rich text names it", (await lastDoc(page)).content[1].attrs.src, `attachment:${PHOTO}`);
    await page.close();

    // "Shown" waits for the note's photos, so the words never fade in with a hole where one goes.
    page = await open(browser, `![](attachment:${PHOTO})\n\nUnder it`, null, { sources: { [PHOTO]: picture(40, 30) }, delay: 150 });
    const order = await page.evaluate(() => window.__msgs.map((m) => m.type ?? m.data?.actionId).filter((t) => t === "answered" || t === "onReady"));
    check("photos: a note is shown once its photos are drawn", order.join(" > "), "answered > onReady");
    check("photos: a note that starts with a photo doesn't open with it outlined", (await photoState(page))[0].outline, "none");
    await page.close();

    // From rich text, a photo holds its shape before it's drawn (nothing moves when it is); a slow
    // answer doesn't hold the note back.
    const sized = { type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "Over it" }] },
      { type: "image", attrs: { src: `attachment:${PHOTO}`, width: 300, height: 400 } },
      { type: "paragraph", content: [{ type: "text", text: "Under it" }] },
    ] };
    page = await open(browser, "", sized, { sources: {}, delay: 5000 });
    photos = await photoState(page);
    check("photos: a photo holds its shape before it's drawn", photos[0].shape.startsWith("0.75"), true);
    check("photos: …and a slow answer doesn't hold the note back", photos[0].classes.includes("drawn"), false);
    await page.close();

    page = await open(browser, `![](attachment:${PHOTO})`, null, { sources: { [PHOTO]: picture(30, 100) } });
    check("photos: a tall photo is shown no taller than 3:5", (await photoState(page))[0].shape.startsWith("0.6"), true);
    await page.close();

    // Not on this phone: a quiet outline in its place, and the note keeps it.
    page = await open(browser, `![](attachment:${PHOTO})\n\nWords`, null, { sources: {} });
    photos = await photoState(page);
    check("photos: one the phone doesn't have shows as an outline", photos[0].classes.includes("missing") && photos[0].src === null, true);
    await setCaret(page, "Words", 5);
    await pause(page, 200);
    await type(page, "!");
    await pause(page);
    check("photos: …and stays in the note", await last(page, "onChange"), `![](attachment:${PHOTO})\n\nWords!`);
    await page.close();

    // An image with any other address (a web image typed into a note elsewhere): kept as written, never loaded.
    page = await open(browser, "![](https://example.com/photo.png)\n\nWords", null, { sources: {} });
    photos = await photoState(page);
    check("photos: a web image is never loaded, nor asked for", photos[0].classes.includes("missing") && photos[0].src === null && (await asked(page)).length === 0, true);
    await setCaret(page, "Words", 5);
    await pause(page, 200);
    await type(page, "!");
    await pause(page);
    check("photos: …and is kept as written", await last(page, "onChange"), "![](https://example.com/photo.png)\n\nWords!");
    await page.close();

    // Read from Markdown, each photo is on a line of its own: one with words on the very next line
    // (as a plain-text editor can leave it), and one in a list item (its Markdown puts the photo
    // right under the item's words).
    page = await open(browser, `![](attachment:${PHOTO})\nWords under\n\n- An item\n  ![](attachment:${OTHER})`, null, {
      sources: { [PHOTO]: picture(40, 30), [OTHER]: picture(40, 30) },
    });
    check("photos: a photo with words right under it, and one in a list item, are each a line of their own", await tree(page), "image paragraph(text) bulletList(listItem(paragraph(text),image)) paragraph");
    await setCaret(page, "Words under", 11);
    await pause(page, 200);
    await type(page, ".");
    await pause(page);
    check("photos: …and read back the same", await last(page, "onChange"), `![](attachment:${PHOTO})\n\nWords under.\n\n- An item\n  ![](attachment:${OTHER})`);
    await page.close();

    // The photo button: a photo on a line of its own after the cursor's line, with the cursor on an empty line under it.
    page = await open(browser, "First line\n\nLast line", null, { sources: { [PHOTO]: picture(40, 30) } });
    await setCaret(page, "First line", 5);
    await pause(page, 200);
    await run(page, "insertPhoto", JSON.stringify({ id: PHOTO, width: 1600, height: 1200 }));
    await type(page, "Under it");
    await pause(page);
    check("photos: a photo goes in after the cursor's line, with the cursor under it", await last(page, "onChange"), `First line\n\n![](attachment:${PHOTO})\n\nUnder it\n\nLast line`);
    check("photos: …with its size", JSON.stringify((await lastDoc(page)).content[1].attrs), JSON.stringify({ src: `attachment:${PHOTO}`, alt: null, title: null, width: 1600, height: 1200 }));
    check("photos: …asked for, and drawn", (await photoState(page))[0].classes.includes("drawn"), true);
    await page.close();

    page = await open(browser, "", null, { sources: { [PHOTO]: picture(40, 30) } });
    await page.click(".ProseMirror");
    await run(page, "insertPhoto", JSON.stringify({ id: PHOTO, width: 40, height: 30 }));
    await type(page, "Words");
    await pause(page);
    check("photos: on an empty line, the photo takes the line's place", await last(page, "onChange"), `![](attachment:${PHOTO})\n\nWords`);
    await page.close();

    // Backspace under a photo chooses it; only the next one takes it away. Typing with it chosen writes under it.
    page = await open(browser, `Over it\n\n![](attachment:${PHOTO})\n\nUnder it`, null, { sources: { [PHOTO]: picture(40, 30) } });
    await setCaret(page, "Under it", 0);
    await pause(page, 200);
    await page.keyboard.press("Backspace");
    await pause(page);
    photos = await photoState(page);
    check("photos: Backspace at the start of the line under a photo chooses it", photos[0].classes.includes("ProseMirror-selectednode") && photos[0].outline, "solid");
    check("photos: …and takes nothing away", (await calls(page, "onChange")).length, 0);
    await type(page, "So ");
    await pause(page);
    check("photos: typing with a photo chosen writes on the line under it", await last(page, "onChange"), `Over it\n\n![](attachment:${PHOTO})\n\nSo Under it`);
    await setCaret(page, "So Under it", 0);
    await pause(page, 200);
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await pause(page);
    check("photos: a second Backspace takes the chosen photo away", await last(page, "onChange"), "Over it\n\nSo Under it");
    await page.close();

    // An empty line under a photo just goes, and the photo is chosen (the editor's own Backspace).
    const emptyUnder = { type: "doc", content: [
      { type: "image", attrs: { src: `attachment:${PHOTO}` } },
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: "After" }] },
    ] };
    page = await open(browser, "", emptyUnder, { sources: { [PHOTO]: picture(40, 30) } });
    await page.evaluate(() => document.querySelector(".ProseMirror").editor.chain().focus().setTextSelection(2).run());
    await pause(page, 200);
    await page.keyboard.press("Backspace");
    await pause(page);
    check("photos: an empty line under a photo goes, and the photo is chosen", (await photoState(page))[0].classes.includes("ProseMirror-selectednode") && (await last(page, "onChange")), `![](attachment:${PHOTO})\n\nAfter`);
    await page.close();

    // A paste brings in photos named by id only: never a web page's images, nor one written into the note.
    page = await open(browser, "Start", null, { sources: { [PHOTO]: picture(40, 30) } });
    await setCaret(page, "Start", 5);
    await pause(page, 200);
    await page.evaluate((id) => {
      const data = new DataTransfer();
      data.setData("text/html", `<p>Pasted</p><img src="https://example.com/a.png"><img src="data:image/png;base64,iVBORw0KGgo="><img src="attachment:${id}"><p>End</p>`);
      document.querySelector(".ProseMirror").dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, PHOTO);
    await pause(page);
    check("photos: a paste keeps only photos named by id", ((await last(page, "onChange")) ?? "").match(/!\[[^\]]*\]\([^)]*\)/g)?.join(" "), `![](attachment:${PHOTO})`);
    await page.close();
  } finally {
    await browser.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();
