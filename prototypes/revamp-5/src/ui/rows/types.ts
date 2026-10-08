import type React from "react";
import type { SharedValue } from "react-native-reanimated";
import type { StyleProp, ViewStyle } from "react-native";
import type { Task } from "../../store/model";
import type { RingLook } from "../CircleCheck";
import type { TaskVariant, TitleLook } from "../TaskRow";

/**
 * A look for Today's task rows (round 3 of the calmer rows, 2026-10-07):
 * how one row is drawn, and optionally how the list around the rows is laid
 * out. Each look lives in its own file in src/ui/rows and is listed in
 * src/ui/rows/index.ts; the web build picks one with `?rows=<id>`.
 *
 * TaskRow keeps the working parts (the swipe, the tick and its beat, the
 * quick menu, opening the task, the press wash, screen-reader labels) and
 * hands them to the look already wired, as functions that return elements.
 */
export type LookRowProps = {
  task: Task;
  variant: TaskVariant;
  /** Where it sits in the list as drawn (0 is the first). */
  index: number;
  /** Ticked, or being ticked. */
  checked: boolean;
  /** The tick's beat: the line through the words is drawing. */
  ticking: boolean;
  /** Where a focus session left off, if one did. */
  leftOff: string | null;
  /** Saved on the phone, not sent yet. */
  unsent: boolean;
  /** The title of the note it came from, if any. */
  noteTitle: string | null;
  /** The task's words: they strike through as it's ticked. */
  title: (look?: TitleLook) => React.ReactElement;
  /**
   * The check: a 44-point target that ticks and unticks, labelled "Mark … done".
   * It draws Sage's CircleCheck (filling with the accent on a tick) at `size`,
   * `quiet` for a thin grey ring; or whatever `draw` returns for its state.
   */
  check: (opts?: { size?: number; style?: StyleProp<ViewStyle>; hitSlop?: number; draw?: (state: { on: boolean; pressed: boolean }) => React.ReactNode } & RingLook) => React.ReactElement;
  /** The part that opens the task on a tap, with the quick menu on a long press and the press wash. `accessibilityLabel` names the row for VoiceOver. */
  open: (children: React.ReactNode, style?: StyleProp<ViewStyle>, opts?: { accessibilityLabel?: string }) => React.ReactElement;
  /** The press wash, 0 to 1 (TaskRow draws it under the row; a look drawing its own surface can use it too). */
  wash: SharedValue<number>;
};

export type LookListProps = {
  /** The day's open tasks, in the day's order. */
  tasks: Task[];
  variant: TaskVariant;
  /** A whole row (swipe, tick, menu), drawn by this look's Row, keyed by task.id, arriving, leaving and closing up. `entering` replaces its arrival (e.g. a stagger). */
  renderRow: (task: Task, index: number, opts?: { entering?: unknown }) => React.ReactElement;
  /** Today's day, for folding (see useDayFold); absent on other days. */
  foldKey?: string;
};

export type Look = {
  id: string;
  label: string;
  /** What's behind a row: the card's colour, the page's, or nothing (the list draws it). */
  surface: "card" | "page" | "none";
  Row: (props: LookRowProps) => React.ReactElement;
  /** The list around the rows (container, grouping, headers, fold). Without it: the rows on one card, a hairline between. */
  List?: (props: LookListProps) => React.ReactElement;
  /** Today's small centred "Tasks" heading: kept (the default), or left out because the List draws its own. */
  heading?: "keep" | "none";
  /** The part of a row that's its card (e.g. a margin on its left): the swipe's colour and the press wash cover only that. */
  rowInset?: { left?: number; right?: number };
  /**
   * The look keeps the day's finished tasks in its list (in place, settled):
   * Today hands it the day's planned tasks, open and done, in plan order, and
   * Done below holds only what was finished but planned for another day.
   */
  ownsDone?: boolean;
  /** "quiet": Today's buttons under the list (Add task, Catch up, Done) step back onto the quiet surface. */
  actionsSurface?: "quiet";
};
