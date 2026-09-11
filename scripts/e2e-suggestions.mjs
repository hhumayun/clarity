// End-to-end test of the suggestions endpoint against the local server.
//   node scripts/e2e-suggestions.mjs
import fs from "fs";
import superjson from "superjson";

for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  const key = t.slice(0, eq).trim();
  if (process.env[key] === undefined) process.env[key] = t.slice(eq + 1).trim();
}

const BASE = process.env.BASE_URL ?? "http://localhost:3333";

async function clerkApi(path, options = {}) {
  const res = await fetch(`https://api.clerk.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Clerk ${path} -> ${res.status}`);
  return res.json();
}

const users = await clerkApi("/users?limit=1");
const session = await clerkApi("/sessions", {
  method: "POST",
  body: JSON.stringify({ user_id: users[0].id }),
});
const { jwt: token } = await clerkApi(`/sessions/${session.id}/tokens`, {
  method: "POST",
  body: JSON.stringify({}),
});

async function suggest(label, body) {
  const start = Date.now();
  const res = await fetch(`${BASE}/_api/suggestions/generate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: superjson.stringify(body),
  });
  const parsed = superjson.parse(await res.text());
  if (!res.ok) {
    console.log(`FAIL  ${label} -> ${res.status}: ${JSON.stringify(parsed)}`);
    process.exitCode = 1;
    return;
  }
  const stems = parsed.suggestions?.map((s) => `[${s.category}] ${s.text}`) ?? [];
  const completions = parsed.completionSuggestions?.map((s) => s.text) ?? [];
  console.log(`PASS  ${label} (${Date.now() - start}ms)`);
  console.log(`      stems: ${stems.length ? stems.join(" | ") : "(none)"}`);
  console.log(`      completions: ${completions.length ? completions.join(" | ") : "(none)"}`);
  console.log(`      question: ${parsed.reflectionQuestion}`);
}

// Sentence finished -> expect sentence-starter stems
await suggest("finished sentence", {
  title: "A good day",
  textBeforeCursor: "This morning I walked to the lake with Mom. The water was calm and we talked about her garden.",
});

// Mid-sentence -> expect completions
await suggest("unfinished sentence", {
  title: "A good day",
  textBeforeCursor: "This morning I walked to the lake with Mom. After lunch we sat on the bench and",
});

// Empty note -> expect gentle starters
await suggest("empty note", { title: "", textBeforeCursor: "" });
