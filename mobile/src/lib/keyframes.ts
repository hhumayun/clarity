/**
 * CSS-style keyframes for Reanimated: a value at each stop, eased between
 * stops the way CSS applies a timing function per segment. Worklets, so they
 * run on the UI thread, and plain functions, so they can be tested.
 */

export const LINEAR = 0;
export const EASE_IN_OUT = 1;
export const EASE_OUT = 2;

function ease(x: number, mode: number): number {
  "worklet";
  if (mode === EASE_IN_OUT) {
    // CSS ease-in-out is cubic-bezier(.42,0,.58,1); smoothstep matches it closely.
    return x * x * (3 - 2 * x);
  }
  if (mode === EASE_OUT) {
    const inv = 1 - x;
    return 1 - inv * inv * inv;
  }
  return x;
}

/**
 * The value at `t` (0..1 through one loop). `stops` ascend from 0 to 1 and
 * may repeat a stop where CSS lists two percentages for one value.
 */
export function keyframe(t: number, stops: number[], values: number[], mode: number): number {
  "worklet";
  if (t <= stops[0]) return values[0];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i]) {
      const a = stops[i - 1];
      const b = stops[i];
      const x = b === a ? 1 : (t - a) / (b - a);
      return values[i - 1] + (values[i] - values[i - 1]) * ease(x, mode);
    }
  }
  return values[values.length - 1];
}
