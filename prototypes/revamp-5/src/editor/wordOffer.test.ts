// @ts-nocheck -- a plain script for Node, which runs .ts files directly.
// Run from the project root: /opt/node24/bin/node --import ./scripts/ts-resolve.mjs src/editor/wordOffer.test.ts
// What of word help's offer still fits as the writer types on (src/editor/wordOffer.ts).
import { fitsNow, insertionFor, typedSince, wantsNew } from "./wordOffer.ts";

let failures = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
};
const finish = (text) => ({ text, kind: "finish", source: "ai" });
const start = (text) => ({ text, kind: "start", source: "ai" });
const MID = "The light on the water was";
const offer = { id: 1, anchor: MID, finishes: [finish("so soft and golden"), finish("like scattered coins"), finish("quiet and still")], starts: [start("It felt like"), start("Then we stopped"), start("Next time I want")] };
const shown = (before) => {
  const fits = fitsNow(offer, before);
  return fits ? { finishes: fits.finishes.map((fit) => fit.idea.text), starts: fits.starts.map((fit) => fit.idea.text) } : null;
};
const ALL_STARTS = ["It felt like", "Then we stopped", "Next time I want"];

// As offered.
check("nothing typed: all of it fits", shown(MID), { finishes: ["so soft and golden", "like scattered coins", "quiet and still"], starts: ALL_STARTS });
check("a space typed: all of it still fits", shown(`${MID} `), { finishes: ["so soft and golden", "like scattered coins", "quiet and still"], starts: ALL_STARTS });

// Typing on keeps what begins the same way (the strip doesn't change with every key).
check("typing the start of a finish keeps it", shown(`${MID} s`), { finishes: ["so soft and golden"], starts: ALL_STARTS });
check("…in any case", shown(`${MID} So`), { finishes: ["so soft and golden"], starts: ALL_STARTS });
check("…word by word", shown(`${MID} so soft `), { finishes: ["so soft and golden"], starts: ALL_STARTS });
check("a word no finish begins with lets them go, but not the starts", shown(`${MID} grey`), { finishes: [], starts: ALL_STARTS });
check("a finish typed out goes", shown(`${MID} so soft and golden`), { finishes: [], starts: ALL_STARTS });

// Once the sentence is over: the starts, and then the one begun.
check("a full stop: the finishes go, the starts stay", shown(`${MID} grey.`), { finishes: [], starts: ALL_STARTS });
check("…and the next sentence begun keeps the start it begins", shown(`${MID} grey. Then`), { finishes: [], starts: ["Then we stopped"] });
check("…and one none begins with: nothing fits", shown(`${MID} grey. Later`), null);
check("a new line: the starts stay", shown(`${MID} grey\n`), { finishes: [], starts: ALL_STARTS });

// Offered after a full stop: no finishes, and typing narrows the starts at once.
const over = { id: 2, anchor: "It rained all day.", finishes: [], starts: [start("It felt like"), start("Then we stopped")] };
check("after a full stop: typing narrows the starts", fitsNow(over, "It rained all day. It")?.starts.map((fit) => fit.idea.text), ["It felt like"]);

// Elsewhere, or back past it.
check("deleting back past what was offered: none of it", shown("The light on the wat"), null);
check("the cursor somewhere else: none of it", shown("Another line entirely"), null);
check("written well past it: none of it", shown(`${MID} ${"x".repeat(90)}`), null);

// The editor's window before the cursor moves on as a long note grows.
const long = "a".repeat(500) + " The light on the water was";
const longOffer = { ...offer, anchor: long };
const moved = (long + " so").slice(-long.length);
check("a long note: what's typed is found though the window moved", typedSince(long, moved), " so");
check("…and what fits is the same", fitsNow(longOffer, moved)?.finishes.map((fit) => fit.idea.text), ["so soft and golden"]);

// What goes in.
const fitFor = (before, text) => [...fitsNow(offer, before).finishes, ...fitsNow(offer, before).starts].find((fit) => fit.idea.text === text);
check("nothing typed: all of it, spaced", insertionFor(fitFor(MID, "so soft and golden"), MID, ""), { text: " so soft and golden ", trimBefore: false });
check("begun: only the rest", insertionFor(fitFor(`${MID} so s`, "so soft and golden"), `${MID} so s`, ""), { text: "oft and golden ", trimBefore: false });
check("begun in another case: the writer's letters stay, the rest goes in", insertionFor(fitFor(`${MID} So`, "so soft and golden"), `${MID} So`, ""), { text: " soft and golden ", trimBefore: false });
check("a start mid-sentence ends the sentence first", insertionFor(fitFor(MID, "Then we stopped"), MID, ""), { text: ". Then we stopped ", trimBefore: true });
check("a start begun after a full stop: the rest", insertionFor(fitFor(`${MID} grey. Then w`, "Then we stopped"), `${MID} grey. Then w`, ""), { text: "e stopped ", trimBefore: false });
check("no space before punctuation after the cursor", insertionFor(fitFor(`${MID} so`, "so soft and golden"), `${MID} so`, ", then"), { text: " soft and golden", trimBefore: false });

// When new words are wanted.
check("nothing offered: wanted", wantsNew(null, MID), true);
check("what's there fits: not wanted", wantsNew(offer, `${MID} so`), false);
check("mid-sentence with no finish fitting: wanted", wantsNew(offer, `${MID} grey and`), true);
check("a sentence over with starts fitting: not wanted", wantsNew(offer, `${MID} grey. `), false);
check("a sentence begun that no start fits: wanted", wantsNew(offer, `${MID} grey. Later`), true);
check("moved well past it: wanted", wantsNew(offer, `${MID} so soft and golden, and the air was cold`), true);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
