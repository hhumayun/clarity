# Model choice (measured on this account, Sep 2026)

Both AI paths use `kimi-k2` on the OpenAI Chat Completions wire. This was
measured, not guessed — do not "upgrade" to a reasoning model without
re-measuring.

Latency for the same short JSON prompt:

| model             | result                        |
| ----------------- | ----------------------------- |
| kimi-k2           | ~0.8s, clean JSON             |
| gemini-3.5-flash  | ~1.8s, clean JSON             |
| gpt-5.5           | ~1.8s, no text via output_text |
| gpt-5.6-luna      | ~2.0s, no text via output_text |
| claude-sonnet-4-6 | ~2.3s                         |
| glm-5             | ~13s                          |
| glm-5-flash       | ~26s                          |

Notes:
- `gpt-5.6-luna` and `gemini-2.5/3.1-flash` are NOT available here.
  `gpt-5.6-luna` also rejects `reasoning: { effort: ... }`.
- On the Responses wire the installed `@floot/ai` does not populate
  `output_text` — walk `r.output` if you ever switch to a `gpt-*` model.
- `glm-5` with `chat_template_kwargs: { thinking: false }` still spent its
  whole token budget on reasoning and returned empty content at
  `max_tokens: 1000`. That is what produced silent empty suggestion rows.
- The `@floot/ai` type union here is older than the guides: unknown model
  names typecheck as errors but may still be served. Type errors do not
  block running, so probe before trusting either signal.

Suggestions end up ~3-5s in practice (the prompt carries related-note
excerpts and history). That is inside the intended envelope: the bubble row
never blocks typing. If it needs to be faster, shrink the context before
changing the model.

## Why entity indexing is client-driven

`queueTask` is a Pro-only feature, so background indexing does not use it.
The editor calls `POST /_api/notes/reindex` 4s after typing settles, and the
notes list fires a catch-up backfill once per session. A save must never
wait on a model call, and a suggestion must never wait on indexing.

An unreadable model reply must NOT set `notes.entities_hash` — that would
freeze the note out of retrieval permanently. Only a genuinely empty
`entities` array counts as "indexed with nothing in it".
