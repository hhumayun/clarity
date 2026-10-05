import { Easing } from "react-native-reanimated";

/**
 * Motion: soft and physical. Signal's vocabulary, the one the earlier
 * revamps proved, re-tuned for cards on a page.
 *
 * - The frequency gate first: anything met all day (scroll, the keyboard,
 *   push and back, switching tabs) keeps the platform's motion.
 * - A finger means a spring. A card gives a little under a press and comes
 *   back with a hair of overshoot; a marker stretches toward where it goes.
 * - What a finger didn't start is a timing on one strong ease-out. Exits
 *   are quicker than entrances and leave the way they came.
 * - Buttons answer in place: a label rolls to the next one, a spinner or a
 *   check grows where the words were. Nothing pops up to confirm.
 * - Reduce Motion: springs settle without overshoot, travel becomes a
 *   cross-fade, loops stop.
 */
export const duration = {
  press: 90, // squash in
  quick: 160, // small changes and exits
  base: 220, // a check, a chip, a label rolling over
  enter: 300, // content arriving (timed fallback)
  roll: 280, // a word or digit rolling over
  morph: 260, // a button changing shape
  flood: 600, // colour filling the screen at the start of focus
  wave: 2600, // one swell of the focus surface
  stream: 28, // one word of a reflection appearing
} as const;

/** Strong ease-out: quick to leave, long to land. */
export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
/** Symmetric, for things that go and come back. */
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);
/** Loops (a cloud's drift, a star's twinkle, the focus surface) swell on a sine. */
export const breathe = Easing.inOut(Easing.sin);

/**
 * Springs. `pop` springs back from a squash or grows a check (overshoot on
 * scale only); `glide` carries a marker with one soft overshoot; `settle`
 * lands dead; `lead`/`trail` are the two edges of a pill that stretches as
 * it moves; `sheet` presents things that float; `bloom` opens the + dial.
 */
export const spring = {
  pop: { duration: 420, dampingRatio: 0.58 },
  glide: { duration: 460, dampingRatio: 0.78 },
  lead: { duration: 320, dampingRatio: 0.82 },
  trail: { duration: 540, dampingRatio: 0.86 },
  settle: { duration: 380, dampingRatio: 1 },
  sheet: { duration: 360, dampingRatio: 0.84 },
  bloom: { duration: 420, dampingRatio: 0.7 },
} as const;
/** Under Reduce Motion every spring lands without overshoot. */
export const calm = { duration: 300, dampingRatio: 1 } as const;

/** Arrivals step down the screen this far apart, and only on first sight. */
export const stagger = 40;
/** How far arriving content travels, and how small it starts. */
export const rise = 12;
export const arriveScale = 0.98;
/** A press squashes a button or card to this; a row inside a card gives less. */
export const squash = 0.97;
export const squashRow = 0.985;
