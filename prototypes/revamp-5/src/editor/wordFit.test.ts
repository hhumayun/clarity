// @ts-nocheck -- a plain script for Node, which runs .ts files directly.
// Run from the project root: /opt/node24/bin/node src/editor/wordFit.test.ts
// How offered words are cased and spaced where they go in (src/editor/wordFit.ts).
import { fitWords, sentenceOver } from "./wordFit.ts";

let failures = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
};
const put = (words, kind, before, after = "") => fitWords(words, kind, before, after);

// Finishing the sentence at the cursor.
check("a finish follows the last word, with a space", put("about the leak", "finish", "I need to call the plumber"), { text: " about the leak ", trimBefore: false });
check("…and no second space after one already typed", put("about the leak", "finish", "I need to call the plumber "), { text: "about the leak ", trimBefore: false });
check("…in the model's own casing mid-sentence", put("Sam and me", "finish", "We went with"), { text: " Sam and me ", trimBefore: false });
check("…capitalised if there's no sentence left to finish", put("then we left", "finish", "It rained."), { text: " Then we left ", trimBefore: false });
check("…at the very start, capitalised with no space before", put("today was", "finish", ""), { text: "Today was ", trimBefore: false });

// Starting the next sentence.
check("a start after a full stop is capitalised", put("it made me feel", "start", "We talked for hours."), { text: " It made me feel ", trimBefore: false });
check("a start after an unfinished sentence closes it first", put("it made me feel", "start", "We talked for hours "), { text: ". It made me feel ", trimBefore: true });
check("a start after a comma goes on in lower case", put("And then I", "start", "We talked for hours,"), { text: " and then I ", trimBefore: false });
check("…but \"I\" keeps its capital", put("I keep thinking", "start", "Still,"), { text: " I keep thinking ", trimBefore: false });
check("a start on a new line is capitalised, with no space before", put("next time", "start", "First line\n"), { text: "Next time ", trimBefore: false });

// What follows the cursor.
check("no space is added before a space that's there", put("about it", "finish", "I wrote", " later"), { text: " about it", trimBefore: false });
check("no space goes before punctuation after the cursor", put("about it", "finish", "I wrote", ". Then"), { text: " about it", trimBefore: false });
check("a space goes before a word after the cursor", put("about it", "finish", "I wrote", "later"), { text: " about it ", trimBefore: false });
check("extra spaces in the offer are trimmed", put("  about it ", "finish", "I wrote"), { text: " about it ", trimBefore: false });

// When a sentence is over.
check("over: nothing yet", sentenceOver(""), true);
check("over: after a full stop and a space", sentenceOver("It rained. "), true);
check("over: after a new line", sentenceOver("A line\n"), true);
check("not over: mid-sentence", sentenceOver("It rained and"), false);
check("not over: after a comma", sentenceOver("It rained,"), false);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
