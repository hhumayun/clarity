# Investigations

Findings from digging into reported behaviour, kept so the next person does not
repeat the work. Newest first. An entry stays here once it is resolved — the
evidence is the point, not the status.

---

## Suggested tasks disappear if you leave a note without deciding

**Reported:** 2026-09-23 · **Status:** open, fix recommended but not started

### Symptom

"Find tasks" suggested tasks in a note. After leaving the note without adding
or dismissing them, reopening it showed no suggestions, though no decision had
been made. Seen on the uncle note: "Ask about test results in 6 months" was
suggested, never added, and could not be brought back.

### Cause

Suggestions are never stored. They live only in the `suggestions` state of
`mobile/src/ui/NoteTasks.tsx`, and of `components/NoteTasks.tsx` on the web.

- `endpoints/tasks/extract_POST.ts` writes the note's content hash to
  `task_extractions` as soon as it returns suggestions, before the writer has
  decided anything.
- On reopening, `tasks/list` reports `hasExtracted: true`, so the automatic
  first look does not run again.
- Tapping "Find tasks" takes the unchanged-content shortcut in `extract_POST.ts`
  and returns `{ suggested: [], unchanged: true }`, shown as "Nothing new".
- The suggestions only come back once the note is edited and its hash changes.

Confirmed against the database on 2026-09-23. The stored hash for the uncle
note matched its current content, and only the Friday task had been saved
from it.

### Related gap

"Dismiss" only clears local state. Re-extraction filters out suggestions that
are already tasks, by `source_fingerprint` or identical text, but nothing
records a dismissal. Any edit to the note brings dismissed suggestions back.

### Recommended fix

Store suggestions on the server, each marked pending or dismissed.

- A new `task_suggestions` table: `id`, `user_id`, `note_id`, `fingerprint`
  (from `taskFingerprint`), `text`, `project_name`, `complete_by`, `status`
  (`pending` or `dismissed`) and `created_at`, unique on
  `(note_id, fingerprint)`. It needs a new migration (006 is taken by the
  notes list index) and must be approved before it is applied to Neon.
- `extract_POST` replaces the note's pending rows with the new result, skipping
  fingerprints that are dismissed or already tasks, so a line deleted from the
  note stops being suggested.
- `tasks/list` for a note returns its pending suggestions, so reopening shows
  them without another AI call.
- `tasks/add` removes the pending rows it turns into tasks. A new dismiss
  endpoint marks rows dismissed.
- Both clients render suggestions from the server instead of local state.
- Keep `complete_by` as a calendar day and send it at noon UTC through
  `dueDayAsDate`, so the day-shift fix in `4ed7749` carries over.

### Lighter alternative

Keep pending suggestions on the phone in AsyncStorage, keyed by note. No
database change, but the web app would not see them, and dismissals would
still not survive an edit.

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
