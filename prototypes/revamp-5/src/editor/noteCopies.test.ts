// @ts-nocheck -- a plain script for Node, which runs .ts files directly.
// Run from the project root: /opt/node24/bin/node src/editor/noteCopies.test.ts
// Which copy of a note goes on screen (src/editor/noteCopies.ts).
import { draftWins, serverCopyReplaces } from "./noteCopies.ts";

let failures = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};
const t = (seconds: number) => new Date(Date.UTC(2026, 9, 6, 9, 0, seconds));
const copy = (seconds: number, content = "words", doc: unknown = null) => ({ updatedAt: t(seconds), content, doc });

check("a draft written after the server's copy wins", draftWins({ at: t(10).getTime() }, copy(5)));
check("a draft written before it loses", !draftWins({ at: t(5).getTime() }, copy(10)));
check("at the same moment, the server's copy stands", !draftWins({ at: t(5).getTime() }, copy(5)));
check("no draft: the server's copy", !draftWins(null, copy(5)));
// An edit made offline at 0:30 and sent later is stamped 0:30 (changedAt); the
// draft written as it was typed, a moment later, still wins.
check("an offline edit's time doesn't make the server's copy beat its own draft", draftWins({ at: t(31).getTime() }, { updatedAt: t(30).toISOString(), content: "x" }));
check("dates kept as text on the phone are read too", draftWins({ at: t(10).getTime() }, { updatedAt: t(5).toISOString(), content: "x" }));

const base = { openedFromDraft: false, waiting: false, untouched: true, shown: copy(5) };
check("a newer server copy replaces an untouched note", serverCopyReplaces({ ...base, fetched: copy(9, "newer") }));
check("…but never once something's been typed", !serverCopyReplaces({ ...base, untouched: false, fetched: copy(9, "newer") }));
check("…nor while a change made here waits to be sent", !serverCopyReplaces({ ...base, waiting: true, fetched: copy(9, "newer") }));
check("…nor over a note opened from its draft", !serverCopyReplaces({ ...base, openedFromDraft: true, fetched: copy(9, "newer") }));
check("an older or same-time copy doesn't replace it", !serverCopyReplaces({ ...base, fetched: copy(5, "words") }));
check("the same words with rich text the phone lacked do", serverCopyReplaces({ ...base, fetched: copy(5, "words", { type: "doc" }) }));
check("rich text with other words at the same time doesn't", !serverCopyReplaces({ ...base, fetched: copy(5, "other", { type: "doc" }) }));

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
