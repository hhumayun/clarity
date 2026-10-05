# Investigations

Findings from digging into reported behaviour, kept so the next person does not
repeat the work. Newest first. An entry stays here once it is resolved — the
evidence is the point, not the status.

---

## Backspace does nothing after an empty line under a quote is removed

**Reported:** 2026-10-04 · **Status:** fixed 2026-10-04, not yet confirmed on
the phone

### Symptom

In a note with a quote followed by a checklist:
1. Enter twice at the end of the quote's last line makes an empty line under
   the quote.
2. Backspace removes it, and the cursor goes back to the end of the quote's
   last line.
3. From then on Backspace deleted nothing, until the cursor was moved. Enter
   had stuck the same way after a quote earlier.

### Evidence

- **The editor's trace:** each Backspace arrived (`keydown`) with no deletion
  after it (no `beforeinput`). Every time, the press before had been handled
  by the same keymap.
- **Reproduced in desktop Chrome:** after that Backspace, the cursor
  (`view.state.selection`) was an instance of a different `TextSelection`
  class from ProseMirror's own. Setting the same cursor again with Tiptap's
  `setTextSelection` made Backspace work.

### Causes

1. **Tiptap's quote package carries its own copy of ProseMirror.**
   - `@tiptap/extension-blockquote` 3.27.1 (the version the app is held at)
     was published with prosemirror-model, prosemirror-state and
     prosemirror-transform bundled into its `dist/index.js`. The other Tiptap
     packages import them.
   - Its Backspace rule (a later line in a quote steps out of it; a line right
     under a quote joins its last line) sets the cursor with that private
     `TextSelection`.
   - ProseMirror's guard against the browser deleting across lines
     (`stopNativeHorizontalDelete` in prosemirror-view) checks
     `instanceof TextSelection`, gets false, and cancels the key. On the
     iPhone, ProseMirror's handling of Enter stalled on it too.
2. **The iPhone sends Shift with Backspace when its keyboard is set to
   capitalise**, as at the start of every new line.
   - The editor's line-start rules for Backspace (lists, checklists, ticked
     rows) skipped any Backspace with a modifier. At the start of a new line,
     Tiptap's generic `Shift-Backspace` (ProseMirror's `joinBackward`) ran
     instead.
   - Deduced from the trace: a Backspace at an empty line's start reached none
     of those rules and logged no outcome, which only the modifier check
     allowed. The trace now logs `shift=` to confirm it.
   - Likely also behind the strikethrough carry-over: a new checklist row
     joined into the ticked row above it.

### Fix

In `mobile/src/editor/NoteEditor.tsx`:
- **`Quote`:** Tiptap's quote, with its Backspace replaced by
  `backspaceAtQuote`. It does the same things with ProseMirror's own
  `TextSelection`.
- **Shift+Backspace:** gets the same rules as Backspace. The keymaps see a
  plain Backspace.
- **One press, one action:** the guard against iOS acting on a press the
  editor already handled now resets on every new key press, not only on a
  timer.
- **Tests:** in `tests/note-editor`, for both quote cases and Shift+Backspace.

### To check

- **On the phone:** the quote case, and whether the strikethrough carry-over
  is gone. The trace's `shift=` confirms cause 2.
- **After upgrading Tiptap:** search
  `node_modules/@tiptap/extension-blockquote/dist/index.js` for "prosemirror"
  to see whether it still carries its own copy. The override can stay either
  way.

---

## Notes don't open offline in the dev build

**Reported:** 2026-10-04 · **Status:** open, to review; nothing started

### Symptom

Offline, notes don't load in Clarity Dev (the EAS development build). From
the code, an opened note stays on its grey placeholder lines and its text
never appears.

### Cause

- **The note's data is on the phone.** The lists are saved to the phone
  (`mobile/src/sync/persist.ts`), and the note screen opens a note from that
  copy (`findCachedNote` in `mobile/app/(app)/note/[id].tsx`).
- **The editor page isn't, in a dev build.** The note body is a web page (an
  Expo DOM component, `mobile/src/editor/NoteEditor.tsx`). In a development
  build Expo fetches it from the dev server each time a note opens:
  `getBaseURL()` in `expo/src/dom/base.ts` returns `<dev server>/_expo/@dom`.
  Offline the phone can't reach the dev server, the page never loads,
  `onReady` never fires, and the placeholder (shown until `editorReady`)
  stays.
- **Release builds put the page inside the app.** With `NODE_ENV` production,
  `getBaseURL()` returns `www.bundle`, and `expo export:embed` (run by the
  Xcode build) writes DOM components there (`exportEmbedAsync.js` in
  `@expo/cli`). So it should open offline in a release build. Not yet checked
  on a device.
- **Related limits:**
  - The dev build loads all its JavaScript from the dev server, so it can't
    start offline at all. An app already open keeps running.
  - In any build, a note that has never been in a list on the phone (one on
    an older page not yet scrolled to, say) can't open offline. The app says
    "This note isn't on this phone yet".

### Options

1. **Fallback (recommended):** if the editor hasn't reported ready after a few
   seconds, or the web view reports a load error, show the note's text as
   plain text instead of the placeholder, and try the editor again when back
   online. This makes offline testing in the dev build mostly work, and guards
   the real app if the web view ever fails.
   - **Where:** the editor area of `note/[id].tsx` (`BootedNoteEditor`, and the
     placeholder shown while `!loaded || !editorReady`). Load errors come from
     react-native-webview's `onError` and `onHttpError`, passed in through the
     `dom` props.
   - **Open question:** read-only, or plain editing? A save without `doc`
     clears the note's rich copy on the server (`notes/update_POST.ts`), so
     anything only the rich copy holds (a heading's indent, say) would be
     lost.
2. **Release-mode check:** an EAS "preview" build (internal distribution), to
   confirm the editor opens offline before the rich editor ships. It uses one
   of the 15 iOS builds a month, so start it only with a go-ahead.

---

## Note editor: the note jumps while typing at the end of a line

**Reported:** 2026-10-02 · **Status:** fixed 2026-10-02.

- **Checked on the phone with logging:** taps in the text, flicks through
  a long note, the keyboard opening and closing, and typing in a short
  note.
- **Not yet in a logged session:** typing past the end of a line in a
  long note, and a tap under the text.

### Symptoms

- Scrolling in the note editor felt unpredictable.
- Typing at the end of a long note sometimes threw the view back to the top
  of the note, just as a line wrapped.
- Tapping just under the last line put the keyboard away.

### Causes

1. **The jump to the top.**
   - The text (a multiline `TextInput`, its own scrolling off, no height)
     grows with its words inside a `ScrollView`, the page.
   - A line that wraps at the end is in the text one render before the box
     grows to fit it; Fabric applies the new frame in `updateLayoutMetrics`.
   - In between, iOS asks where the cursor is, on a line with no layout yet,
     and gets no usable position. keyboard-controller's source notes that a
     growing input reports its selection as 0/-1 there, and waits a frame
     before reading it.
   - iOS then scrolls the page to that position: the top of the text.
   - The same bug is reported upstream in react-native
     [#49226](https://github.com/facebook/react-native/issues/49226),
     [#48412](https://github.com/react/react-native/issues/48412) and
     [#58517](https://github.com/react/react-native/issues/58517).
   - The upstream fix,
     [#58520](https://github.com/react/react-native/pull/58520), isn't in
     React Native 0.86.3. Expo Go can't take native patches.
2. **The cursor jumping to the end.** The logs caught this three times.
   - A flick that started on the text counted as a press when the finger
     lifted. iOS defaults `rejectResponderTermination` to true, so the
     text's press handling (Pressability) is not cancelable and a scroll
     can't take the touch away.
   - The press focused the text with the cursor where it last was, often
     the end. iOS had not seen a tap, so it had placed nothing, and the page
     went after the cursor.
3. **The keyboard going away.** A tap under the last line lands on the
   page, not the text, and `keyboardShouldPersistTaps="handled"` dismisses
   the keyboard for a tap no child handles.

### What did not work: letting the text scroll itself

The first fix made the text fill the pane and scroll itself.

- **What it fixed:** the jump to the top stopped.
- **What it broke:** typing at the end of a long note moved the view a
  line or two at a time.
- **Why:** a text view that scrolls itself only lays out the lines on
  screen and estimates the height of the rest (TextKit 2). It keeps
  correcting the estimate, and each correction moves what is on screen.
  Apple says this is by design
  ([TextKit 2: the promised land](https://blog.krzyzanowskim.com/2025/08/14/textkit-2-the-promised-land/)).
- **What the logs showed:**
  - The same text, while scrolling, reported heights of 3,230 → 3,184 →
    3,204 → 3,218 → 3,140 → 3,234 → 3,296 points.
  - While typing, it went 3,453 → 3,503 → 3,453 within 6 ms, and the view
    moved 35 points up and back.
- **Why it stays out:** nothing the app can reach in Expo Go turns this
  off. A text that does not scroll has to lay out every line, which is
  why the growing text is back.

### Fix

- **The text grows with its words again, and the page scrolls.** Every
  line is laid out.
- **iOS's own scrolling of the page is switched off.**
  - It uses keyboard-controller's `ClippingScrollView`, which makes the
    page's `scrollRectToVisible:animated:` do nothing.
  - It is the piece keyboard-controller's `KeyboardAwareScrollView` is
    built on. That component itself would make room for the keyboard a
    second time, on top of `GentleKeyboardAvoidingView`.
- **`useCaretFollow` (`mobile/src/hooks/useCaretFollow.ts`) keeps the
  cursor in view instead,** on the UI thread. It acts:
  - when the cursor moves, using keyboard-controller's positions and
    skipping ones with no usable position;
  - frame by frame while the room for the keyboard grows;
  - when the text grows with the cursor at its end.

  It keeps a line of room under the cursor, so a line that wraps at the end
  is on screen before the text grows. Until keyboard-controller reports,
  the touch point stands in for the cursor, because keyboard-controller
  starts listening a frame after the text gains focus.
- **A scroll takes the touch away from the text:**
  `rejectResponderTermination={false}`.
- **The rest of the page under the text is a `Pressable`.** A tap there
  puts the cursor at the end and keeps the keyboard up, as in Notes.
- **There is room under the last line,** so the page is never at its very
  end while writing there. Lines that come and go below the cursor (iOS's
  grey completions wrapping) change nothing on screen.

### Known gaps

- **Cursors set by the app.** A cursor placed in the middle of the text by
  the app (a suggestion added mid-note) is only followed from the next
  keystroke.
- **`ClippingScrollView` is not meant to be used directly.**
  keyboard-controller calls it a low-level piece, so check it again on the
  next Expo SDK upgrade.
  - Its patch stays on the native scroll view, which React Native reuses
    for other `ScrollView`s.
  - The Focus screen's `KeyboardAwareScrollView` already does the same.
- **The title suggestion** still pushes the note down when it opens above
  the text.

---

## iOS's grey word completions reach the app as typed text

**Reported:** 2026-10-02 (found in the editor's logs) · **Status:** open,
not confirmed.

### Suspected symptom

Leaving a note while a grey completion is showing may save the completion
as if it had been typed.

### Evidence

While a predicted word was being typed, the app's copy of the text grew to
the full predicted length after each key (3,505 characters typed, 3,513
with the completion), then dropped back before the next.

### Cause

- iOS shows its inline predictions as marked text, the same mechanism as
  Chinese or Japanese input in progress.
  [Flutter had to handle this](https://github.com/flutter/flutter/pull/183650).
- React Native reports marked text as part of the text, so `content`
  holds the completion while it is showing.
- `leave()` saves `contentRef.current` at once.

### To confirm

1. Type part of a word until a grey completion appears.
2. Tap back straight away.
3. Reopen the note and see whether the completed word is there.

### Possible fix

On leaving, blur the text first and save once iOS has removed the
completion. With react-navigation, that means `beforeRemove` with
`preventDefault()`, then dispatching the navigation again.

---

## "Next year oct 2" is read as this year's Oct 2

**Reported:** 2026-10-01 · **Status:** open, fix suggested, not started

### Symptom

Typing "Call dr lee on next year oct 2" in the add-task box set the date to
Fri 2 Oct 2026, tomorrow at the time, instead of 2 Oct 2027. "next year" was
left in the task's words ("Call dr lee on next year").

### Cause

Checked with chrono-node 2.10.1 against today = Thu 1 Oct 2026:

| Line | chrono's results | Our date |
|---|---|---|
| "…on next year oct 2" | "next year" (only `year` certain), "oct 2" (`month`, `day`) | 2026-10-02 |
| "…next year on oct 2" | same two results | 2026-10-02 |
| "…on oct 2 next year" | same two results | 2026-10-02 |
| "…on oct 2 2027" | one result, "oct 2 2027" (`year`, `month`, `day`) | 2027-10-02 ✓ |
| "Call dr lee next year" | "next year" (only `year`) | none |

1. chrono returns "next year" and "oct 2" as separate results. Its merging
   refiners join a date with a time ("Friday at 3pm"), never a relative year
   with a month and day. On its own, "oct 2" resolves to the next Oct 2
   (`forwardDate`).
2. `readDueDate` (`mobile/src/lib/dueDate.ts`, mirrored in
   `helpers/dueDate.tsx`) keeps only results with a certain `day`, `weekday`
   or `month`, to ignore vague matches. "next year" only has `year`, so it is
   skipped and left in the text. On its own it gives no date at all.

### Suggested fix

In `readDueDate`, not in chrono:

- **Combine:** when a line has a month-and-day result and a separate relative
  year result ("next year", "in 2 years", "the year after"), take the month
  and day from one and the year from the other, and strip both phrases from
  the text.
  - Expected: "Call dr lee on next year oct 2" becomes "Call dr lee", due Sat
    2 Oct 2027.
- **Open question:** "next year" on its own, either left undated as
  "someday" is, or read like "in a year" (the same day next year).
- **Keep the two copies in step:** add the cases above to the date-reading
  test list, and change both copies.

---

## Changes made offline are stamped with the time they sync, not when they were made

**Reported:** 2026-10-01 · **Status:** open, small follow-up to offline support, not started

### Symptom

A note or task edited offline shows the time it reached the server as its
"last edited" time, not the time it was edited. A note changed at 10:00 on a
plane and synced at 14:00 reads as edited at 14:00, and moves in "recently
edited" ordering accordingly.

### Cause

The outbox (`mobile/src/sync/`) sends each change when there is a connection.
`notes/update_POST.ts` and `tasks/update_POST.ts` set `updatedAt: new Date()`,
the server's clock at arrival. Creates already carry the phone's time
(`createdAt`, and `endedAt` for focus sessions, clamped by
`helpers/clientIds.tsx#notInFuture`), but updates do not.

### Suggested fix

- **Phone:** stamp each queued `note.update` and `task.update` with the time it
  was made (`changedAt`). When the outbox folds several edits together
  (`addToQueue` in `mobile/src/sync/outbox.ts`), keep the latest.
- **Server:** accept an optional `changedAt` in `notes/update` and
  `tasks/update`, and use `notInFuture(changedAt)` for `updatedAt`. Older
  clients that leave it out keep today's behaviour.
- **Check:** the note editor compares a local draft's time with the server's
  `updatedAt` to pick the newer copy (`note/[id].tsx`, `applyNote`). A
  back-dated `updatedAt` must not make an older server copy look newer than a
  draft written after it.

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
