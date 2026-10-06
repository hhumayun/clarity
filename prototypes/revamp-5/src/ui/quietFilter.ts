import { useEffect, useState } from "react";
import { tick } from "./haptics";

/**
 * A filter that changes a long, animated list at once and quietly
 * (2026-10-06). With the rows' exit and layout animations on, choosing an
 * area made every leaving row fade out and every staying row slide into
 * place: dozens of animations, and the measuring they need, which is what
 * made filtering lag. So, a frame apart:
 * 1. the tap answers at once: a tick, and the chips show the choice;
 * 2. the rows put their animations down (`quiet`);
 * 3. the list changes (`shown`), with nothing animating;
 * 4. the animations come back, for ticking a task off.
 *
 * `chosen` is for the chips, `shown` for the list.
 */
export function useQuietFilter<T>(initial: T) {
  const [chosen, setChosen] = useState(initial);
  const [shown, setShown] = useState(initial);
  const [quiet, setQuiet] = useState(false);
  const changing = !Object.is(chosen, shown);

  // The next frame after a choice (or after the previous step), one step on.
  useEffect(() => {
    if (!changing && !quiet) return;
    const frame = requestAnimationFrame(() => {
      if (!changing) setQuiet(false);
      else if (!quiet) setQuiet(true);
      else setShown(chosen);
    });
    return () => cancelAnimationFrame(frame);
  }, [changing, quiet, chosen]);

  const choose = (next: T) => {
    tick();
    setChosen(next);
  };
  // The app changing it, not a tap (the chosen area renamed or removed): no tick.
  const reset = (next: T) => setChosen(next);

  return { chosen, shown, quiet, choose, reset };
}
