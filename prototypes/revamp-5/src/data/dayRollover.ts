import { useEffect } from "react";
import { AppState } from "react-native";
import { today } from "../lib/dates";
import { getSage } from "./sage";

// How often, while the app is open, it looks whether the day has turned.
const LOOK_EVERY_MS = 60_000;

/**
 * The day turning while the app stays open, or in memory overnight: if you
 * were on today, you're on the new today, and it slides in like any other
 * day. If you were looking at another day, you stay there. Before, Today
 * kept yesterday under its heading until something else changed
 * (2026-10-06).
 */
export function useDayRollover() {
  useEffect(() => {
    let shownToday = today();
    const look = () => {
      const now = today();
      if (now === shownToday) return;
      const onToday = getSage().viewDay === shownToday;
      shownToday = now;
      if (onToday) getSage().setViewDay(now);
    };
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") look();
    });
    const timer = setInterval(look, LOOK_EVERY_MS);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, []);
}
