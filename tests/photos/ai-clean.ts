// No photo link reaches an AI model (docs/photos-server.md, 8.2 and 11.2
// check 19). In-process: OPENROUTER_API_KEY is fake and globalThis.fetch is
// replaced, so every request meant for OpenRouter is captured and answered
// with canned JSON; nothing leaves this machine. Uses the local database
// (PGlite, :5440) for noteEntityIndex and generateSuggestions, with a
// throwaway local user. Also unit cases for withoutAttachments,
// attachmentIdsOf and appendPhotos (helpers/attachmentRefs.tsx).
//
//   tsx tests/photos/ai-clean.ts        (from the worktree root; api-check.mjs runs it too)
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postgres from "postgres";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const DATABASE_URL = `postgres://postgres@localhost:${process.env.CHECK_PG_PORT || 5440}/postgres`;

// Before any helper is imported: they read these when loaded.
process.env.DATABASE_URL = DATABASE_URL;
process.env.OPENROUTER_API_KEY = "fake";
for (const name of Object.keys(process.env)) if (name.startsWith("PHOTOS_")) delete process.env[name];

let passed = 0;
let failed = 0;
function ok(name: string, pass: boolean, detail = "") {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${!pass && detail ? `  (${detail})` : ""}`);
}
async function group(title: string, fn: () => Promise<void>) {
  console.log(`\n== ${title}`);
  try {
    await fn();
  } catch (error) {
    ok(`${title}: ran to the end`, false, String(error instanceof Error ? error.message : error).split("\n")[0]);
  }
}

// Every OpenRouter request, captured; anything else goes out as usual (only the local database is used).
const captured: string[] = [];
const realFetch = globalThis.fetch;
const CANNED = JSON.stringify({
  title: "A short walk",
  tasks: [],
  summary: "You went for a walk.",
  progress: [],
  entities: [],
  suggestions: [],
});
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("openrouter.ai")) {
    captured.push(typeof init?.body === "string" ? init.body : String(init?.body ?? ""));
    return new Response(JSON.stringify({ choices: [{ message: { content: CANNED } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(input, init);
}) as typeof fetch;

const load = async <T>(path: string) => (await import(pathToFileURL(join(ROOT, path)).href)) as T;
const PHOTO = "![](attachment:abcd1234-photo)";
const clean = (bodies: string[]) => bodies.every((b) => !b.includes("attachment:"));
const take = () => captured.splice(0, captured.length);

const sql = postgres(DATABASE_URL, { max: 1, prepare: false, ssl: false, onnotice: () => {} });
let userId: number | null = null;

try {
  await group("19a. each AI source, captured", async () => {
    const { suggestNoteTitle } = await load<{ suggestNoteTitle: (c: string) => Promise<string | null> }>("helpers/suggestNoteTitle.tsx");
    take();
    await suggestNoteTitle(`A walk by the river.\n\n${PHOTO}\n\nCold but bright.`);
    const t = take();
    ok("suggestNoteTitle: one call, no attachment:", t.length === 1 && clean(t), `${t.length} calls`);
    const none = await suggestNoteTitle(`\n${PHOTO}\n`);
    const t2 = take();
    ok("a note holding only a photo makes no title call", t2.length === 0 && none === null, `${t2.length} calls, ${none}`);

    const { extractTasks } = await load<{ extractTasks: (i: { title: string; content: string; projectNames: string[]; currentDate: string }) => Promise<unknown> }>("helpers/extractTasks.tsx");
    await extractTasks({ title: "Errands", content: `Buy milk.\n\n${PHOTO}\n\nCall the vet on Friday.`, projectNames: [], currentDate: "2026-10-09" });
    const e = take();
    ok("extractTasks: no attachment:", e.length >= 1 && clean(e), `${e.length} calls`);

    const { summarizeTask } = await load<{ summarizeTask: (i: unknown, d: string) => Promise<unknown> }>("helpers/summarizeTask.tsx");
    const at = new Date("2026-10-08T10:00:00Z");
    await summarizeTask({
      task: { text: "Fix the fence", description: "", status: "todo", completeBy: null },
      notes: [{ id: "n1", title: "Fence", content: `Bought posts.\n\n${PHOTO}\n\nNeed nails.`, createdAt: at, updatedAt: at }],
      sessions: [],
    }, "2026-10-09");
    const s = take();
    ok("summarizeTask: no attachment:", s.length >= 1 && clean(s), `${s.length} calls`);

    const { aiChatJson } = await load<{ aiChatJson: (o: { systemPrompt: string; userPrompt: string }) => Promise<string> }>("helpers/ai.tsx");
    await aiChatJson({ systemPrompt: "Answer in JSON.", userPrompt: `Text with a photo ${PHOTO} and a loose attachment:abcd1234-loose` });
    const g = take();
    ok("aiChatJson (the final guard): no attachment:", g.length === 1 && clean(g), `${g.length} calls`);
  });

  await group("19b. note index and suggestions (local database)", async () => {
    const [u] = await sql`insert into users (clerk_id, email, display_name) values (${`local-ai-${Date.now()}`}, 'ai@local.test', 'Throwaway AI') returning id`;
    userId = u.id as number;
    const [n1] = await sql`insert into notes (user_id, title, content) values (${userId}, 'Park', ${`Met Alice at the park.\n\n${PHOTO}\n\nShe brought the dog.`}) returning id`;
    const { noteEntityIndex } = await load<{ noteEntityIndex: (noteId: string, userId: number) => Promise<boolean> }>("helpers/noteEntityIndex.tsx");
    take();
    await noteEntityIndex(n1.id as string, userId);
    const i = take();
    ok("noteEntityIndex: one call, no attachment:", i.length === 1 && clean(i), `${i.length} calls`);

    // A related note for the excerpts: it names Alice, and holds a photo.
    await sql`insert into note_entities (note_id, user_id, type, name, normalized_name) values (${n1.id}, ${userId}, 'person', 'Alice', 'alice')`;
    const [n2] = await sql`insert into notes (user_id, title, content) values (${userId}, 'Today', 'Writing now') returning id`;
    const { generateSuggestions } = await load<{ generateSuggestions: (o: { userId: number; noteId?: string; title?: string; textBeforeCursor: string; mode?: string }) => Promise<unknown> }>("helpers/generateSuggestions.tsx");
    await generateSuggestions({ userId, noteId: n2.id as string, title: "Today", textBeforeCursor: `Saw Alice again ${PHOTO} and then`, mode: "all" });
    const sg = take();
    ok("generateSuggestions: no attachment:", sg.length >= 1 && clean(sg), `${sg.length} calls`);
    ok("…and the related note's excerpt was in the prompt (so the check means something)", sg.some((b) => b.includes("park") || b.includes("dog")), "no excerpt found");
  });

  await group("19c. attachmentRefs unit cases", async () => {
    const refs = await load<{
      withoutAttachments: (t: string) => string;
      attachmentIdsInText: (t: string) => Set<string>;
      attachmentIdsInDoc: (d: unknown) => Set<string>;
      attachmentIdsOf: (c: string, d: unknown) => Set<string>;
      appendPhotos: (c: string, d: unknown, ids: string[]) => { content: string; doc: unknown };
    }>("helpers/attachmentRefs.tsx");
    const w = refs.withoutAttachments(`One.\n\n![](attachment:abcd1234-a)\n\n\n\nTwo ![alt](attachment:abcd1234-b) attachment:abcd1234-c three.`);
    ok("withoutAttachments: no link left", !w.includes("attachment:"), JSON.stringify(w));
    ok("…the words kept, blank lines collapsed", w.includes("One.") && w.includes("Two") && w.includes("three.") && !/\n{3,}/.test(w), JSON.stringify(w));

    const broken = refs.attachmentIdsInText("a broken token ![](attachment:abcd1234-x and more");
    ok("attachmentIdsInText: a broken token still names the photo", broken.has("abcd1234-x"));
    const listDoc = { type: "doc", content: [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "image", attrs: { src: "attachment:abcd1234-li" } }] }] }] };
    ok("attachmentIdsInDoc: an image in a list item", refs.attachmentIdsInDoc(listDoc).has("abcd1234-li"));
    ok("…a double-encoded doc", refs.attachmentIdsInDoc(JSON.stringify(listDoc)).has("abcd1234-li"));
    ok("…an unreadable doc gives nothing", refs.attachmentIdsInDoc("{not json").size === 0);
    ok("…a link image (not attachment:) isn't a photo", refs.attachmentIdsInDoc({ type: "doc", content: [{ type: "image", attrs: { src: "https://x.test/a.png" } }] }).size === 0);
    const of = refs.attachmentIdsOf(`![](attachment:abcd1234-md)`, listDoc);
    ok("attachmentIdsOf: the union", of.has("abcd1234-md") && of.has("abcd1234-li") && of.size === 2);

    const empty = refs.appendPhotos("", null, ["abcd1234-e"]);
    ok("appendPhotos: empty content", empty.content === "![](attachment:abcd1234-e)" && empty.doc === null, JSON.stringify(empty));
    const words = refs.appendPhotos("Words.  \n", null, ["abcd1234-1", "abcd1234-2"]);
    ok("…after words, null doc stays null", words.content === "Words.\n\n![](attachment:abcd1234-1)\n\n![](attachment:abcd1234-2)" && words.doc === null, JSON.stringify(words.content));
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }] };
    const withDoc = refs.appendPhotos("Hi", doc, ["abcd1234-d"]);
    const last = (withDoc.doc as { content: { type: string; attrs?: { src?: string } }[] }).content.at(-1);
    ok("…a doc gets a top-level image node", last?.type === "image" && last.attrs?.src === "attachment:abcd1234-d" && (withDoc.doc as { content: unknown[] }).content.length === 2);
  });
} finally {
  if (userId !== null) {
    await sql`delete from notes where user_id = ${userId}`.catch(() => {});
    await sql`delete from users where id = ${userId}`.catch(() => {});
  }
  await sql.end();
  console.log(failed ? `\nai-clean: ${failed} FAILED, ${passed} passed` : `\nai-clean: all ${passed} passed`);
  process.exit(failed ? 1 : 0);
}
