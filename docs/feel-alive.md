# Making Clarity feel alive

Research from 1 October 2026, saved as a menu of ideas. **Nothing here is built
yet.** It was done to answer "how can we make the app feel more alive?" without
losing what Clarity already is: calm, writerly, plain spoken.

---

## How this was done

- About 25 top-grossing iOS apps were studied through the Appllama design
  library, using roughly 110 of its credits, across three areas:
  - journals and companion apps;
  - planners, task managers and focus timers;
  - calm, ambient and carefully crafted apps.
- The app's own code was surveyed for what already moves and what is static.
- **What was seen:**
  - Inside the apps, Appllama only has still screenshots.
  - Motion was seen only in welcome and onboarding videos, cut into frames.
  - Anything said about movement inside a product is inferred from those.
  - Each app was seen at one time of day, so "changes with the hour" comes
    from greetings and scenes, not from two versions of the same screen.
- **Not covered:** Things 3, Sunsama, Akiflow and Amie are not in the library.
  Rise only has onboarding screens.
- **The example images are not in this repo,** because the repo is public and
  they are other apps' screenshots carrying Appllama's watermark. Every example
  below names its app and screen. The Appllama references for each image are
  listed at the end, so any of them can be fetched again.

---

## Where Clarity starts from

### What already moves

- **One motion vocabulary**, in `mobile/src/ui/motion.ts`:
  - durations of 160, 220 and 280 ms with cubic easing;
  - the stated rule "Short and eased out: things arrive quickly and settle,
    never bounce".
- **Haptics are few** (`mobile/src/lib/haptics.ts`): "a single light cue,
  never a pattern". Undoing is "lighter, so undoing never feels like a win".
- **The day view changes day by fading** out in 110 ms, then rising back in
  over 280 ms. Its dates move under the finger and pull down into a month.
- **Finishing a task:**
  - the row settles over 280 ms: the background goes to the accent colour, the
    corners round, and the check scales in;
  - swipe-to-complete springs back;
  - a "Task added to…" card zooms in.
- **Life Center:**
  - greets by the hour ("Good morning / afternoon / evening");
  - shows "Welcome back · N min of focus today" after a focus session.
- **Focus:**
  - fades between its phases;
  - ends with kind copy: "Time's up. Nice focus." and "Stopped early. That
    still counts."
- **The pomodoro badge** is the only character-like drawing in the app. It
  loops three times then settles, "so it invites without nagging".

### What is static or missing

- **Fonts:** Fraunces is installed (`package.json`) but never loaded. Every
  heading is Nunito Sans Bold.
- **Palettes:**
  - They are named "Morning Paper" and "Evening Sage" but only follow the
    phone's light or dark setting.
  - Nothing changes with the time of day.
- **Pressing anything only dims it.** Nothing scales, and the note cards in
  the Notes list have no press feedback at all.
- **The Notes list:**
  - note rows have no entering or layout motion;
  - `useFocusedMotion()` is called in `(tabs)/index.tsx` but its result is
    unused.
- **The focus ring** jumps once a second instead of running down smoothly.
- **Empty states are text only:**
  - "No notes this day."
  - "Nothing was scheduled."
  - "Everything is done. Enjoy the quiet."
- **Onboarding, login and register** have no motion. The wordmark is plain
  text.
- **No haptic** when a task is added, a sheet opens, a segment switches or a
  long-press lands.
- **The toast** has hard-coded colours that ignore the theme, and it ignores
  the phone's Reduce Motion setting (it uses RN `Animated`).
- **None of these exist:** pull-to-refresh, any record of days written, and
  any illustration beyond the tomato.

---

## The ideas

Grouped by theme. Each says what other apps do, then what it could be in Clarity.
The themes are roughly in order of how strongly the research pointed at them.

### 1. The day changes with the hour

This was the strongest pattern, found independently in all three areas studied.

- **A greeting as the headline.**
  - 5 Minute Journal (Home): small caps "MONDAY 15 JUNE 2026" above a large
    serif "Good Morning, Friend!", with the week strip right below. This is
    almost Clarity's day view.
  - stoic. (Home): a lowercase "good evening." with a full stop.
  - How We Feel: "How are you feeling *this morning*?"
  - *Clarity, Notes day view:*
    - When viewing today, show a Fraunces greeting with one plain Nunito line
      under it, such as "Two notes, one task left."
    - Other days show the date with a relative label ("Last Tuesday",
      "3 weeks ago"), as Timepage does ("THIS WEEK", "7 WEEKS AGO").
- **The header tinted by the hour.**
  - Wayk's welcome video goes from a navy starfield through plum and amber to
    cream as a sun rises, over about 6 seconds.
  - Structured's wake-up and bedtime pickers go from a pink sunny sky to a
    starry navy one.
  - Headspace's Today screen has a blue-sky header.
  - Finch's pet sleeps in a dark night-time room.
  - *Clarity:*
    - Tint only the Notes header and week strip through four stops: dawn
      cream, day paper, dusk peach, night ink.
    - Use Reanimated `interpolateColor`, refresh it every few minutes, and
      cross-fade it when the app returns to the foreground.
    - No sun and no mascot.
- **A prompt that changes with the hour.**
  - I Am Sober: "Make Today's Pledge" in the morning, "Review Today Now" later.
  - *Clarity:* "Write a note…" could become "What matters today?" in the
    morning and "How did today go?" in the evening.
- **A morning and an evening rhythm.**
  - 5 Minute Journal: twin cards, "Morning reflection · Completed ✓" and
    "Evening reflection · Assess your day", with sun and moon glyphs.
  - Rosebud: "Morning Intention" and "Evening Reflection", which greys out
    with a check once done.
  - stoic.: an "End of the Day Reflection" tile.
  - Tiimo: the day split into Anytime, Morning, Afternoon and Evening, each a
    pale tinted pill; an empty one reads "Anytime today works".
  - *Clarity:*
    - After about 6pm, a quiet "Close the day" card on Notes: what got done,
      what carries over, and one line to write. Catch-up could offer "Look
      back on today" at the same hour.
    - Today's notes could also be grouped into morning, afternoon and evening.
- **After dark.**
  - Sleep Cycle's welcome video: a plum-to-teal gradient with clouds drifting
    up, a serif heading, and a Start button with a warm glow.
  - *Clarity:* Notes after dark goes to ink, with a soft glow on the main
    button only.

### 2. The day writes itself

- **What you did appears in the day.**
  - Forest's Timeline is an automatic log ("16:24 Cedar planted").
  - stoic. (History Day Detail) shows "Your first day in stoic" as a quiet
    line inside the day, not a pop-up.
  - *Clarity:* finished tasks and focus sessions appear in the Notes day as
    muted lines with their times: "Finished 'Call Mom' · 4:12pm",
    "Focused 25 min on Essay". Never failure wording.
- **A "now" in the day.**
  - Structured (Daily Timeline) prints the current time, "1:48", in bold in
    the time column, between items, instead of drawing a red line.
  - The rail above "now" is coloured in the tasks' colours; below it, grey.
  - In its week view, past days are filled from morning to night, today is
    filled down to now, and future days are grey.
  - Sorted³'s red "8:09 PM" line is the louder, usual version.
  - *Clarity:*
    - A hairline rail beside timed items, inked down to now, with a small
      "now · 2:48" label that updates each minute.
    - In the week strip, today's mark could fill like a small arc of the sun.
- **Words in the gaps.**
  - Structured: "💤 A well-deserved break." in an empty span, and "Unlock
    potential in 8h 40m. Plan it." in free time.
  - *Clarity:* quiet lines such as "Free until 4pm". Skip the "unlock
    potential" push.
- **The day said back in words.**
  - stoic. (Home): after a check-in, the card reads "Check-In complete." with
    chips "Good Mood · Work · +2 more".
  - 5 Minute Journal: "You're feeling good this morning · Completed".
  - Planta: "Good morning … all tasks have already been checked off."
  - *Clarity:* a one-line recap under the day heading, such as "Two notes,
    three tasks done".

### 3. A calendar that fills up like a record

- **Days marked by what was written.**
  - One Year draws a unique ink doodle for every past day and shows future
    days as dots, with "60%" of the year in the corner. Choosing a mood
    re-tints that day's doodle.
  - Timepage rings days with events and fills today with a solid disc. The
    whole app uses one hue in three tones.
  - stoic. (Mood Calendar): "One dot = One day".
  - *Clarity, week strip and month view:* days with notes get an ink dot sized
    by how much was written, and today is ringed.
- **Past empty days invite filling in.**
  - Daylio's Calendar shows a "+" on past empty days, the mood on logged ones,
    and leaves future days blank. Its add button offers "Today / Yesterday /
    Other day".
  - *Clarity:*
    - A faint "+" on past empty days; tapping one opens "Write a note for
      Tue 14".
    - This depends on the open question of whether a new note takes the day
      being viewed.
- **Consistency without guilt.**
  - Clozemaster: a "Streak | Days Played" switch, "no pressure, just progress".
  - Clarity: CBT uses a candle for its streak instead of a flame.
  - *Clarity:* at most "Days you wrote this month: 9". Never show a 0, a
    broken streak or a level.
- **Past entries resurface.**
  - Day One (Today): "On This Day", with year chips (2025, 2024, 2023). Its
    empty state reads "No past memories yet! Create an entry now, and you'll
    see it here next year."
  - Gratitude Plus has a Memories tab.
  - Timepage has an "On this day" card.
  - *Clarity:* a quiet "A year ago today" (or "A month ago") line under the
    day's notes, with Day One's forward-looking wording when there is none.

### 4. A Focus screen that breathes

- **Show when it ends.**
  - Tiimo (Active Focus Session): "Focus" in a serif, with "11:47 AM →
    12:02 PM" under it, and "+1 min" beside pause.
  - Routinery: "All ends 9:22pm".
  - *Clarity:* the task name with "until 3:25pm" under it, and a "+5 min".
- **A ring that runs down smoothly.**
  - Clarity's ring currently redraws once a second.
  - *Clarity:* animate the ring smoothly between ticks.
- **Numerals.**
  - Focus Keeper: hairline "14:57" over a tick ruler.
  - Tiimo: a serif "15 MINS" inside a ticked dial.
  - *Clarity:* Fraunces Light numerals, perhaps over a tick scale that slides
    as time passes.
- **Breathing motion behind the timer.**
  - Headspace's welcome video: an orange dome rises over about 2 s on
    "Breathe in" and sinks over about 4 s on "Breathe out", as the labels
    cross-fade.
  - How We Feel's breathing screens: dot fields swell and shift hue with each
    phase, with an italic serif "Inhale / Hold / Exhale".
  - Balance: one thin wave line on black.
  - *Clarity:*
    - An 8–10 s scale and opacity loop (`withRepeat`) or a hairline wave
      behind the timer.
    - Off under Reduce Motion.
- **Something that grows.**
  - Forest's pot shows the full tree at setup and a sprout while running; the
    headline changes from "Start planting today!" to "Hang in there!".
  - *Clarity:* one quiet object that grows with elapsed time, such as ink
    filling a page or a leaf unfurling. A muted "jar" of the day's sessions is
    the only form of FocusPomo's pile of tomatoes that would fit.
- **The room dims.**
  - Focus Friend: the room is lit at setup and goes dark during the session;
    afterwards a bright room asks "Start a break timer?".
  - Its "Cancel (6)" button looks like a short window to undo.
  - *Clarity:* the background steps into a warm dusk when Focus starts and
    lifts when it ends, with a few seconds to undo the start.
- **Settling in.**
  - Forest's Mindfulness video: a 3-2-1 countdown, a circle that grows on
    "Breathe in" and shrinks on "Breathe out", "Keep holding to leave", and at
    the end "Do you feel your mind is calmer?".
  - Routinery's night routine opens on a large "Exhale".
  - *Clarity:*
    - An optional three-breath settle before Focus, with a soft haptic on
      each in-breath.
    - Press and hold to leave.
- **Sound.**
  - Insight Timer offers a carousel of starting bells and a separate ending
    bell.
  - Tiimo has a "Lo-Fi" pill; Forest shows "Playing: Forest Rain".
  - *Clarity:* one soft start chime and one end bell, paired with haptics.
    There is already `focus-chime.wav`.
- **Kind endings.**
  - Focus Friend after giving up: "It's OK! We tried!".
  - Routinery: "Should we skip? Move task to end / Skip".
  - *Clarity:*
    - Keep "Stopped early. That still counts.", perhaps with the minutes
      ("Stopped at 18 minutes").
    - Offer to move the task to later.

### 5. Quiet acknowledgement

- **After writing.**
  - Gratitude Plus: a bottom pill, "Day 1 complete — see you tomorrow".
  - Clarity: CBT (Check-In Complete): pills "1 Emotions · 3 Activities ·
    9 Words", then "How are you feeling now? Worse / Same / Better".
  - *Clarity:*
    - On leaving the editor, a small toast such as "Saved · 142 words" or
      "Today's first note", with a light haptic.
    - This would replace today's plain "Saving… / Saved" swap as the moment of
      acknowledgement.
- **Finished tasks settle out of the way.**
  - TickTick (Today List): finished tasks drop into a grey "Completed 3" card.
  - Structured strikes them through with a filled check.
  - Planta: "All tasks completed — New tasks will show up here".
  - *Clarity, Life Center:*
    - After a swipe, the row strikes through and glides into a "Done today · 3"
      fold.
    - An area with nothing left reads "All clear in Health".
- **A haptic when a task is added.** There is none today.
- **Skip and snooze beside complete.**
  - Finch's goal sheet puts "Skip" and "Snooze" next to "Complete".
  - *Clarity:* this would suit Life Center tasks.

### 6. AI that reflects before it asks

- **Mirror, then ask.**
  - Clarity: CBT (Reflection Prompt): two short paragraphs say back what was
    written, then a larger follow-up question, "Reroll Question", thumbs up or
    down, and "Start writing…".
  - How We Feel (Reflect): an italic serif prompt and two buttons, "Finish"
    and "Go deeper".
  - stoic.: one centred prompt card with "Write it Out".
  - Day One: a serif prompt card with a shuffle.
  - *Clarity:*
    - The "Go deeper" suggestion returns one mirrored sentence plus one
      question, in italic Fraunces, with a way to ask for another.
    - The "Write a note…" button could carry one serif prompt a day.
- **A gist for untitled notes.**
  - Clarity: CBT (Entries List) writes card titles ("Contentment Through
    Collaboration") with a summary and feeling tags.
  - Rosebud (Journal History): "✅ Completed Work Before Deadline", a one-line
    summary and "😌 Relieved".
  - *Clarity:* untitled notes in the day list get a suggested title or a
    one-line gist.
- **The editor reacts as you type.**
  - Superlist shows "Tomorrow, 9 AM" and "#meeting" as chips under the title
    as you type.
  - Structured picks the task's icon from its title and tints the sheet in the
    task's colour.
  - *Clarity:*
    - Dates read from the line appear live as chips in the quick add and in
      "Find tasks" results.
    - The life area's colour tints the task sheet.

### 7. Catch-up as insight

- **Themes and people from your own words.**
  - Rosebud (Weekly Insights): "Key Themes: Career" and "Cast of Characters".
  - 5 Minute Journal (Word Insights): frequent words in serif inside a soft,
    blurred pastel orb. It was the calmest data visual seen.
  - *Clarity, Catch-up:* the week's themes and people.
- **Honest "not yet" states.**
  - Rosebud: "Not enough data", and "Unlocks Saturday… Requires 2 more
    entries".
  - stoic. (Trends): "We need data from 2 more days", with three circles, one
    filled.
  - *Clarity:* a concrete countdown when there isn't enough yet.
- **A weekly theme.**
  - stoic. and Rosebud run themes such as "on misunderstandings. Day 2 of 7".
  - *Clarity:* a theme like this could feed the writing suggestions.

### 8. Empty states and the first day

- **One drawing, one sentence.**
  - Bear (Trash): a pale hairline bear and "Hooray! The trash is empty!" in
    light grey.
  - Todoist (Today, empty): a sleepy cup and vase with "Get a clear view of the
    day ahead".
  - Craft: "Your Inbox is clear! Add a task whenever you're ready."
  - *Clarity:* empty days and an empty Catch-up get one low-contrast drawing
    and one sentence.
- **Copy that fits the place.**
  - TickTick's Work list: "Anything to add from work?" with "Start from these
    things".
  - Tiimo's quick add placeholder: "Just one thing".
  - Superlist draws hand-drawn squiggles as placeholder rows.
  - *Clarity:* per-area empty copy ("Nothing for Health yet — anything on your
    mind?") over faint squiggle lines.
- **Never an empty first day.**
  - Day One seeds a "Welcome to Day One" entry ("Here's to the moments you'll
    keep.").
  - Superlist's first list is its tutorial, written as tasks you can tick.
  - *Clarity:* a welcome note in Clarity's voice on day one. Milestones appear
    as muted lines in the day, not pop-ups.

### 9. Groundwork that makes everything above feel finished

- **Load Fraunces.** Use it for the greeting, day headings, focus numerals and
  AI prompts. The serif is much of why 5 Minute Journal, Tiimo and Timepage
  feel warm.
- **Press feedback beyond dimming:**
  - a slight eased scale (about 0.98) on cards and buttons, not a spring, to
    stay within "never bounce";
  - press feedback on note cards.
- **Motion on Notes rows.** Give them entering and layout motion through the
  existing `useFocusedMotion` presets.
- **Make the toast follow the theme and Reduce Motion** (move it to
  Reanimated).
- **A frosted tab bar.** Calm's tab bar is frosted over its scene, which
  `expo-blur` (already installed) can do.
- **Reduce Motion.** Every new loop (breathing, tint) must stop under it.

---

## What to leave out

Each of these came up and clashes with "arrive quickly and settle, never
bounce":

- **Confetti and celebration screens:**
  - Finch's "Hooray! First time completion!";
  - Breeze;
  - Opal's gem "Congratulations!" screens.
- **Mascots and pets:** Finch, Focus Friend, Catzy.
- **Currencies, levels and points:**
  - Forest's coins and species unlocks;
  - Todoist Karma ("400 left to get to Novice");
  - Daylio's "Level 1: Rookie".
- **Streak counters:**
  - Tiimo's streak orbs;
  - Vocal Image's giant "0 days streaks";
  - Clarity: CBT's "NEW MILESTONE" balloon;
  - 5 Minute Journal's streak share pop-up.
- **Guilt copy:**
  - Forest's "Oh no! Your tree has withered.";
  - Focus Friend's "Morris's knitting will unravel. They'll be really sad."
- **Loud motion:** (Not Boring) Weather's 3D vignettes cutting about every
  half second, and its extruded 3D digits.
- **Sales and promotion:** countdown sale banners and promo cards in the main
  view.

---

## Suggested order

1. **Fix the day-switch bug in the Notes day view first** (see the
   `next`-branch notes on `showDay`), because the next step touches the same
   screen.
2. **Time of day, plus Fraunces:**
   - greeting and recap line;
   - header tint;
   - changing "Write a note…" prompt;
   - "Close the day" card.

   This is mostly the Notes header and the theme: the biggest change for the
   least code.
3. **Quiet acknowledgement and the groundwork:**
   - saved toast;
   - "Done today" fold;
   - haptic on add;
   - press feedback;
   - row motion;
   - toast theming.
4. **Focus:** end time, smooth ring, breathing glow, the room dimming.
5. **The day writes itself, and the calendar as a record.**
6. **AI reflections, Catch-up insights, "On this day", empty states.**

---

## Image references

[feel-alive-image-refs.md](feel-alive-image-refs.md) lists every saved image
and the Appllama reference for each screen in it. Any of them can be fetched
again, at one credit each. The images to look at first:

- `jr_pick_timeofday.jpg`: greetings that follow the hour (5 Minute Journal,
  stoic., Finch).
- `pf_pick_now_timeline.jpg`: Structured's day inked down to "now", next to a
  usual red now-line.
- `am_pick_livingcalendar.jpg`: calendars that fill up like a record (One
  Year, Timepage).
- `pf_pick_living_focus.jpg`: focus screens (Forest, Tiimo, Focus Friend).
- `am_pick_breathing.jpg`: breathing motion (Headspace, How We Feel).
- `jr_pick_ai_reflection.jpg`: AI that says back what you wrote, then asks.
