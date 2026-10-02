import { type RefObject, useCallback, useEffect, useRef } from "react";
import { findNodeHandle, type LayoutChangeEvent, type TextInput } from "react-native";
import { useFocusedInputHandler } from "react-native-keyboard-controller";
import type Animated from "react-native-reanimated";
import {
  measure,
  runOnUI,
  scrollTo,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedRef,
  useScrollOffset,
  useSharedValue,
} from "react-native-reanimated";
import { spacing } from "../theme";

// Room kept above the cursor when the page scrolls up to it.
const ROOM_ABOVE = spacing[4];

/**
 * Keeps the cursor of a text that grows with its words in view inside the
 * ScrollView around it (the page). It stands in for iOS's own "scroll to the
 * cursor", which the page has switched off: when a line wrapped at the end,
 * iOS looked for the cursor before the text had grown to fit it, found no
 * position for it, and scrolled the page to the top of the text.
 *
 * The page follows the cursor when it moves (typing, a tap, a selection
 * handle), while the room for the keyboard grows, and when the text grows
 * with the cursor at its end. A line of room is kept under the cursor, so a
 * line that wraps at the end is on screen before the text grows to fit it.
 *
 * The cursor's position comes from react-native-keyboard-controller, which
 * reports it for the focused input on the UI thread; all the scrolling is
 * done there too.
 */
export function useCaretFollow({
  textRef,
  textLength,
  lineHeight,
  keyboardRoom,
}: {
  textRef: RefObject<TextInput | null>;
  /** The text's current length, to tell when the cursor is at its end. */
  textLength: () => number;
  lineHeight: number;
  /** The room being made for the keyboard (GentleKeyboardAvoidingView's). */
  keyboardRoom: SharedValue<number>;
}) {
  const pageRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useScrollOffset(pageRef);
  // A page built anew (back from the Tasks tab) starts at the top; the
  // offset would otherwise hold the old page's until it next scrolls.
  useEffect(() => {
    pageRef.observe(() => {
      scrollY.value = 0;
      return undefined;
    });
  }, [pageRef, scrollY]);
  // keyboard-controller names the focused input by its tag.
  const textTag = useSharedValue(-1);
  const textFocused = useSharedValue(false);
  // Where the text starts in the page.
  const textTop = useSharedValue(0);
  // The cursor, from the top of the text; -1 until it is known.
  const caretTop = useSharedValue(-1);
  const caretBottom = useSharedValue(-1);
  const selectionStart = useSharedValue(-1);
  const selectionEnd = useSharedValue(-1);
  // The same on the JS side, for the text's growth.
  const textHeight = useRef(0);
  const selectionEndNow = useRef(0);
  const textLengthRef = useRef(textLength);
  textLengthRef.current = textLength;

  const keepInView = (animated: boolean) => {
    "worklet";
    if (caretBottom.value < 0) return;
    const page = measure(pageRef);
    if (page === null) return;
    const top = textTop.value + caretTop.value;
    const bottom = textTop.value + caretBottom.value;
    const viewTop = scrollY.value;
    const viewBottom = viewTop + page.height;
    let to: number | null = null;
    if (bottom > viewBottom - lineHeight) to = bottom + lineHeight - page.height;
    else if (top < viewTop + ROOM_ABOVE) to = Math.max(0, top - ROOM_ABOVE);
    // Already there (the keyboard's last frames): nothing to move.
    if (to === null || Math.abs(to - viewTop) < 1) return;
    scrollTo(pageRef, 0, to, animated);
  };

  useFocusedInputHandler(
    {
      onSelectionChange: (event) => {
        "worklet";
        if (event.target !== textTag.value) return;
        const { start, end } = event.selection;
        // A cursor on a line not laid out yet (one that wrapped at the end,
        // before the text has grown to fit it) has no usable position. The
        // text's growth brings the page along instead.
        if (!Number.isFinite(start.y) || !Number.isFinite(end.y) || end.y <= 0 || end.y < start.y) return;
        const collapsed = start.position === end.position;
        // With a selection, follow whichever end moved.
        const startMoved = !collapsed && start.position !== selectionStart.value && end.position === selectionEnd.value;
        selectionStart.value = start.position;
        selectionEnd.value = end.position;
        if (collapsed) {
          caretTop.value = start.y;
          caretBottom.value = end.y;
        } else if (startMoved) {
          caretTop.value = start.y;
          caretBottom.value = start.y + lineHeight;
        } else {
          caretTop.value = end.y - lineHeight;
          caretBottom.value = end.y;
        }
        keepInView(true);
      },
    },
    [lineHeight],
  );

  // As the keyboard comes up the page gets shorter from below, frame by
  // frame: keep the cursor above its bottom edge all the way.
  useAnimatedReaction(
    () => keyboardRoom.value,
    (room, previous) => {
      if (previous === null || room <= previous || !textFocused.value) return;
      keepInView(false);
    },
    [lineHeight],
  );

  // The text grew with the cursor at its end: its last line is the cursor's.
  const followEnd = useCallback(
    (height: number) => {
      "worklet";
      if (!textFocused.value) return;
      caretBottom.value = height;
      caretTop.value = height - lineHeight;
      keepInView(true);
    },
    // keepInView is rebuilt each render from the same values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lineHeight],
  );

  const onTextLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      const grew = height > textHeight.current;
      textHeight.current = height;
      // A text built anew (back from the Tasks tab) has a new tag.
      textTag.value = findNodeHandle(textRef.current) ?? -1;
      if (grew && selectionEndNow.current >= textLengthRef.current()) runOnUI(followEnd)(height);
    },
    [followEnd, textRef, textTag],
  );

  /** On the view that holds the text, directly inside the page. */
  const onTextFrameLayout = useCallback(
    (event: LayoutChangeEvent) => {
      textTop.value = event.nativeEvent.layout.y;
    },
    [textTop],
  );

  const onTextFocus = useCallback(() => {
    textTag.value = findNodeHandle(textRef.current) ?? -1;
    textFocused.value = true;
  }, [textRef, textTag, textFocused]);

  // The cursor of a text left behind is no guide to where it will be next.
  const onTextBlur = useCallback(() => {
    textFocused.value = false;
    caretTop.value = -1;
    caretBottom.value = -1;
    selectionStart.value = -1;
    selectionEnd.value = -1;
  }, [textFocused, caretTop, caretBottom, selectionStart, selectionEnd]);

  /**
   * A touch on the text, from its top. keyboard-controller only starts
   * listening to an input a frame after it gains focus, so the tap that
   * placed the cursor can go unreported: until it reports, the cursor is
   * taken to be where the finger was, so the page can follow it while the
   * keyboard comes up.
   */
  const onTextPressIn = useCallback(
    (y: number) => {
      if (textFocused.value) return;
      caretTop.value = y - lineHeight / 2;
      caretBottom.value = y + lineHeight / 2;
    },
    [lineHeight, textFocused, caretTop, caretBottom],
  );

  /** The selection's end as React Native reports it. */
  const onSelectionEnd = useCallback((end: number) => {
    selectionEndNow.current = end;
  }, []);

  /**
   * The cursor is being put at the end of the text from outside it (a tap
   * under the text): its last line is the cursor's, for the page to follow
   * as the keyboard comes up, or straight away if it is up.
   */
  const onCaretToEnd = useCallback(() => {
    const height = textHeight.current;
    selectionEndNow.current = textLengthRef.current();
    caretTop.value = height - lineHeight;
    caretBottom.value = height;
    if (textFocused.value) runOnUI(followEnd)(height);
  }, [lineHeight, followEnd, caretTop, caretBottom, textFocused]);

  return {
    pageRef,
    scrollY,
    onTextLayout,
    onTextFrameLayout,
    onTextFocus,
    onTextBlur,
    onTextPressIn,
    onSelectionEnd,
    onCaretToEnd,
  };
}
