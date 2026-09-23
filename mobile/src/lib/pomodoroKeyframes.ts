/**
 * The pomodoro badge's keyframes, transcribed from PomodoroBadge.module.css.
 * Percentages become 0..1; a CSS line like "0%, 18% { … }" becomes two stops
 * with the same value. Lengths are in the SVG's 64-unit viewBox.
 */
export const POMODORO_LOOP_MS = 7_000;
export const POMODORO_DELAY_MS = 800;
export const POMODORO_LOOPS = 3;

/** Ring: fills like a timer, holds, then fades for the next loop. Linear. */
export const RING_STOPS = [0, 0.18, 0.7, 0.84, 0.96, 1];
export const RING_DASHOFFSET = [174, 174, 0, 0, 0, 0];
export const RING_OPACITY = [1, 1, 1, 1, 0, 0];
/** Reduce Motion: a calm static timer, about three quarters full. */
export const RING_STATIC_DASHOFFSET = 49;

/** Twist: wind up, release with overshoot, three soft ticks. Ease-in-out. */
export const TWIST_STOPS = [0, 0.08, 0.15, 0.2, 0.24, 0.27, 0.36, 0.375, 0.39, 0.48, 0.495, 0.51, 0.6, 0.615, 0.63, 1];
export const TWIST_DEG = [0, 0, -22, 7, -2, 0, 0, 3, 0, 0, 3, 0, 0, 3, 0, 0];

/** Bounce: squash and hop when the ring completes. Ease-in-out. */
export const BOUNCE_STOPS = [0, 0.7, 0.73, 0.77, 0.81, 0.85, 1];
export const BOUNCE_Y = [0, 0, 0, -4, 0, 0, 0];
export const BOUNCE_SX = [1, 1, 1.07, 0.96, 1.04, 1, 1];
export const BOUNCE_SY = [1, 1, 0.93, 1.05, 0.96, 1, 1];

/** Leaves: lag the twist, flutter on the hop. Ease-in-out. */
export const LEAVES_STOPS = [0, 0.1, 0.16, 0.21, 0.26, 0.3, 0.74, 0.78, 0.82, 0.86, 0.9, 1];
export const LEAVES_DEG = [0, 0, 8, -7, 2, 0, 0, -9, 7, -2, 0, 0];

/** Halo: a soft ripple outward as the ring completes. Ease-out. */
export const HALO_STOPS = [0, 0.76, 0.79, 0.96, 1];
export const HALO_SCALE = [1, 1, 1.02, 1.45, 1.45];
export const HALO_OPACITY = [0, 0, 0.65, 0, 0];

/** Transform origins, in viewBox units. */
export const BOUNCE_ORIGIN = { x: 32, y: 50 };
export const TWIST_ORIGIN = { x: 32, y: 35.5 };
export const LEAVES_ORIGIN = { x: 32, y: 22.5 };
