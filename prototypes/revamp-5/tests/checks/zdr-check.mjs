// Checks that OpenRouter answers the server's kind of request when only
// zero-data-retention endpoints are allowed, and how fast. Run through
// `railway run` so the key comes from the environment; it is never printed.
const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.log("OPENROUTER_API_KEY missing");
  process.exit(1);
}

async function ask(model, zdr) {
  const started = Date.now();
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://clarity-notes-production.up.railway.app",
      "X-Title": "Clarity Notes",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: 'Reply with JSON only: {"words": [three short words]}' },
        { role: "user", content: "Three words to keep going after: The walk this morning was" },
      ],
      max_tokens: 200,
      response_format: { type: "json_object" },
      reasoning: { enabled: false },
      provider: zdr ? { sort: "latency", zdr: true } : { sort: "latency" },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const ms = Date.now() - started;
  const body = await response.json().catch(() => ({}));
  const text = body?.choices?.[0]?.message?.content ?? body?.error?.message ?? "";
  console.log(
    JSON.stringify({ model, zdr, status: response.status, ms, provider: body?.provider ?? null, reply: String(text).slice(0, 80) }),
  );
}

for (let i = 0; i < 4; i++) await ask("deepseek/deepseek-v4.1-flash", true);
await ask("deepseek/deepseek-v4-flash", true);
await ask("deepseek/deepseek-v4.1-flash", false);
