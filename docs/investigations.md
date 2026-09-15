# Investigations

Findings from digging into reported behaviour, kept so the next person does not
repeat the work. Newest first. An entry stays here once it is resolved — the
evidence is the point, not the status.

---

## Sentence completions often do not appear

**Reported:** 2026-09-15 · **Status:** open, fix agreed but not written

### Symptom

Writing in the mobile editor, the "FINISH THIS SENTENCE" chips were missing
while "GO DEEPER" and "KEEP GOING" chips showed normally. Reported against the
text `What is this that is coming up for me `.

### Cause

Two separate things, neither of them a bug in our request or response handling.

**1. Suggestions no longer refresh while typing.** Since `e53d515` they are
fetched only when the Suggestions button is tapped, so the chips on screen are
from whenever it was last pressed. This is intended, and covers the "nothing
happened while I typed" half of the report.

**2. Whether `complete` comes back at all is left to the model.** The system
prompt in `helpers/generateSuggestions.tsx` asks it to return 5 fragments
"when the cursor is inside an unfinished sentence" and an empty array if the
text "already ends in . ! ? or a paragraph break". No code enforces either
branch. The reported sentence is a grammatically complete question, so the
model often decides it is finished and returns nothing.

Measured against the real prompt and model (`gemini-3.5-flash-lite`), five runs
per input, counting entries in `complete`:

```
WITH trailing space: [5, 0, 5, 5, 0]
NO trailing space:   [0, 0, 5, 0, 0]
```

So it is close to a coin flip with a trailing space, and mostly empty without
one — which is the state the text is in the instant a word is finished.

### Ruled out

- **Stale deployment.** `main` and `HEAD` are identical across `helpers/` and
  `endpoints/`, and `main` does contain the completions code.
- **The client.** `mobile/src/api/parse.ts` is a plain `superjson.parse` with no
  filtering. The only client-side filter is the per-session dismissal set in
  `useSuggestions`.
- **A failed API call.** Probing the model reproduced the reflection question
  seen on screen verbatim ("What does this feeling remind you of?"), so the
  request succeeded and returned stems.

### Agreed fix

Decide in code whether the cursor sits mid-sentence and tell the model which
branch to take, rather than asking it to judge — "the cursor is mid-sentence,
return exactly 5 fragments" versus "return an empty array". A single retry when
`complete` comes back empty mid-sentence would close the remaining gap.

### Noticed nearby, not the cause

In `helpers/generateSuggestions.tsx` the stem loop fills the `seen` set before
the completion loop runs, so a completion whose text matches a stem is always
dropped in favour of the stem. Ties never go to the completion.
