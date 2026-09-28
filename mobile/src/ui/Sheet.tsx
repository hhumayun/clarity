import { X } from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { GentleKeyboardAvoidingView } from "./GentleKeyboardAvoidingView";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeldWhileOpen, usePresence } from "../hooks/usePresence";
import { EASE_OUT, MOTION, fadeInFast } from "./motion";
import { fonts, radius, spacing, type Colors } from "../theme";
import { useAppTheme } from "../providers/AppThemeProvider";

type Props = {
  open: boolean;
  title: string;
  /**
   * Drawn in the title's place when given, e.g. a field that edits what the
   * title names. `title` still labels the sheet for screen readers.
   */
  titleInput?: React.ReactNode;
  description?: string;
  /** A small line above the title, e.g. a task's area and date. */
  eyebrow?: React.ReactNode;
  /** Closes the sheet: the × button, dragging it down, or tapping outside it. */
  onClose: () => void;
  /**
   * The × at the top left. Off for a page that wants its title to have the
   * whole width; dragging down and tapping outside still close it.
   */
  showClose?: boolean;
  /**
   * Android's back button, for sheets with pages inside them: step back a
   * page rather than close. Defaults to onClose.
   */
  onBack?: () => void;
  /** A small button at the top right, e.g. deleting what the sheet edits. */
  headerAction?: React.ReactNode;
  children: React.ReactNode;
};

// Dragged down this far (or flicked down, in points a second), the sheet
// closes; any less and it springs back.
const CLOSE_DRAG = 120;
const CLOSE_FLICK = 900;

export function Sheet({
  open,
  title,
  titleInput,
  description,
  eyebrow,
  onClose,
  showClose = true,
  onBack,
  headerAction,
  children,
}: Props) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);

  // Mounted only while open or animating out: a Modal left in the tree after
  // closing keeps a transparent window that swallows every touch under the
  // new renderer (RN clears it only from an old-renderer event).
  const { mounted, progress } = usePresence(open);
  // Keep showing what was there while it slides away.
  const shown = useHeldWhileOpen(open, {
    title,
    titleInput,
    description,
    eyebrow,
    showClose,
    headerAction,
    children,
  });

  // Slide by the sheet's own height once known; until then, off the screen.
  const sheetHeight = useSharedValue(windowHeight);
  // How far a finger has pulled the sheet down. The backdrop lightens with it.
  const dragY = useSharedValue(0);
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value * (1 - Math.min(1, dragY.value / Math.max(1, sheetHeight.value))),
  }));
  // The sheet's height glides when what it shows changes size (another
  // page, a calendar opening), rather than its top edge jumping. It is
  // measured, not left to a layout animation: that animated the frame while
  // the contents had already jumped, and the screen behind showed through.
  // The height is the header plus the content, at most 88% of the room
  // above the keyboard; before the first measurement the sheet sizes itself.
  const room = useSharedValue(0);
  const headerHeight = useSharedValue(0);
  const contentHeight = useSharedValue(0);
  const bottomPad = useSharedValue(Math.max(insets.bottom, spacing[4]));
  const height = useSharedValue(0);
  const measured = useSharedValue(false);
  useEffect(() => {
    bottomPad.value = Math.max(insets.bottom, spacing[4]);
  }, [insets.bottom, bottomPad]);
  useAnimatedReaction(
    () => {
      if (room.value <= 0 || headerHeight.value <= 0 || contentHeight.value <= 0) return -1;
      const natural = SHEET_PADDING_TOP + headerHeight.value + contentHeight.value + bottomPad.value;
      return Math.min(natural, room.value * MAX_SHARE);
    },
    (target) => {
      if (target < 0) return;
      if (!measured.value) {
        // First size: the sheet is sliding in, so no glide on top of that.
        height.value = target;
        measured.value = true;
        return;
      }
      height.value = withTiming(target, { duration: MOTION.slow, easing: EASE_OUT });
    },
  );
  const sheetStyle = useAnimatedStyle(() => ({
    ...(measured.value ? { height: height.value } : {}),
    transform: [{ translateY: (1 - progress.value) * sheetHeight.value + dragY.value }],
  }));
  useEffect(() => {
    if (open) dragY.value = 0;
  }, [open, dragY]);
  // Once it has gone, forget its size, so the next opening measures afresh
  // and starts at its natural height. (Reset here rather than on opening:
  // by then the new page may already have reported its size.)
  useEffect(() => {
    if (mounted) return;
    measured.value = false;
    headerHeight.value = 0;
    contentHeight.value = 0;
  }, [mounted, measured, headerHeight, contentHeight]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const close = useCallback(() => onCloseRef.current(), []);

  // With the keyboard up, dragging the list lowers the keyboard (and the
  // sheet settles back down) rather than pulling the sheet away.
  const [keyboardShown, setKeyboardShown] = useState(false);
  const keyboardUp = useSharedValue(false);
  useEffect(() => {
    if (!open) return;
    const up = Keyboard.isVisible();
    setKeyboardShown(up);
    keyboardUp.value = up;
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => {
      setKeyboardShown(true);
      keyboardUp.value = true;
    });
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => {
      setKeyboardShown(false);
      keyboardUp.value = false;
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [open, keyboardUp]);

  // Where the list is scrolled to, and where the header ends: a drag that
  // starts on the header always moves the sheet, one on the list only once
  // the list is at its top.
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });
  const headerBottom = useSharedValue(0);
  const fromHeader = useSharedValue(false);
  const pulling = useSharedValue(false);
  const pullStart = useSharedValue(0);

  // The list scrolls natively; the pull runs alongside it and only takes
  // over at the top, the way a system sheet does.
  const listGesture = useMemo(() => Gesture.Native(), []);
  const pull = useMemo(
    () =>
      Gesture.Pan()
        .simultaneousWithExternalGesture(listGesture)
        .activeOffsetY([-8, 8])
        .failOffsetX([-16, 16])
        .onBegin((event) => {
          "worklet";
          fromHeader.value = event.y <= headerBottom.value;
          pulling.value = false;
        })
        .onUpdate((event) => {
          "worklet";
          if (!pulling.value) {
            const canPull = fromHeader.value || (scrollY.value <= 0 && !keyboardUp.value);
            if (!canPull || event.translationY <= 0) return;
            pulling.value = true;
            pullStart.value = event.translationY;
          }
          dragY.value = Math.max(0, event.translationY - pullStart.value);
        })
        .onEnd((event) => {
          "worklet";
          if (!pulling.value) return;
          if (
            dragY.value > Math.min(CLOSE_DRAG, sheetHeight.value * 0.3) ||
            (event.velocityY > CLOSE_FLICK && dragY.value > 12)
          ) {
            // Slides on down from where the finger left it.
            runOnJS(close)();
          } else {
            dragY.value = withTiming(0, { duration: MOTION.base, easing: EASE_OUT });
          }
        })
        .onFinalize(() => {
          "worklet";
          pulling.value = false;
        }),
    [listGesture, close, dragY, sheetHeight, scrollY, headerBottom, fromHeader, pulling, pullStart, keyboardUp],
  );

  if (!mounted) return null;

  return (
    // The Modal itself does not animate: its built-in "slide" moved the dim
    // backdrop up with the sheet, like a dark wall rising. Here the backdrop
    // fades while the sheet slides.
    <Modal visible transparent animationType="none" onRequestClose={onBack ?? onClose}>
      {/* A Modal is its own window: gestures inside it need their own root. */}
      <GestureHandlerRootView style={styles.flex}>
      {/* Makes room for the keyboard on the UI thread, gliding a little
          slower than the keyboard itself. React Native's own avoiding view
          drove this with LayoutAnimation, which under the new renderer ran
          out of step with the keyboard and lurched. */}
      <GentleKeyboardAvoidingView style={styles.flex}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={styles.fill} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>
        {/* This box fills the room the keyboard leaves, and measures it. It
            must fill it: an earlier wrapper sized itself to the sheet, so the
            88% limit came out as 88% of the sheet's own height, and every
            sheet lost its last eighth. Touches pass through it to the
            backdrop. */}
        <View
          style={styles.room}
          pointerEvents="box-none"
          onLayout={(event) => {
            room.value = event.nativeEvent.layout.height;
          }}
        >
        <GestureDetector gesture={pull}>
        <Animated.View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing[4]) }, sheetStyle]}
          onLayout={(event) => {
            sheetHeight.value = event.nativeEvent.layout.height;
          }}
        >
          <View
            onLayout={(event) => {
              const { y, height: h } = event.nativeEvent.layout;
              headerBottom.value = y + h;
              headerHeight.value = h;
            }}
          >
            <View style={styles.handle} />
            <View style={styles.headerRow}>
              {shown.showClose ? (
                <Pressable
                  onPress={onClose}
                  hitSlop={8}
                  style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <X size={22} color={colors.foreground} />
                </Pressable>
              ) : null}
              <View style={styles.headerText}>
                {shown.eyebrow ? <View style={styles.eyebrow}>{shown.eyebrow}</View> : null}
                {/* A new title fades in with the page it names. */}
                {shown.titleInput ? (
                  <Animated.View key="titleInput" entering={fadeInFast}>
                    {shown.titleInput}
                  </Animated.View>
                ) : (
                  <Animated.Text key={shown.title} entering={fadeInFast} style={styles.title}>
                    {shown.title}
                  </Animated.Text>
                )}
              </View>
              {shown.headerAction ? <View style={styles.headerAction}>{shown.headerAction}</View> : null}
            </View>
            {shown.description ? (
              <Animated.Text key={shown.description} entering={fadeInFast} style={styles.description}>
                {shown.description}
              </Animated.Text>
            ) : null}
          </View>
          {/* With the keyboard up, dragging the list pulls the keyboard down
              with the finger and the sheet settles back to the bottom; the
              list bounces then so even a short one can be dragged. Otherwise
              it does not bounce at its top, so pulling the sheet down moves
              the sheet alone. */}
          <GestureDetector gesture={listGesture}>
            <Animated.ScrollView
              onScroll={onScroll}
              scrollEventThrottle={16}
              bounces={keyboardShown}
              alwaysBounceVertical={keyboardShown}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              contentContainerStyle={styles.body}
              onContentSizeChange={(_, h) => {
                contentHeight.value = h;
              }}
            >
              {shown.children}
            </Animated.ScrollView>
          </GestureDetector>
        </Animated.View>
        </GestureDetector>
        </View>
      </GentleKeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const HEADER_BUTTON = 36;
const SHEET_PADDING_TOP = spacing[3];
/** The most of the room above the keyboard a sheet may take. */
const MAX_SHARE = 0.88;

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    flex: { flex: 1, justifyContent: "flex-end" },
    backdrop: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: "rgba(28, 27, 25, 0.4)",
    },
    fill: { flex: 1 },
    room: { flex: 1, justifyContent: "flex-end" },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      maxHeight: "88%", // MAX_SHARE
      paddingHorizontal: spacing[6],
      paddingTop: SHEET_PADDING_TOP,
      // Clips the page while the height glides to fit it.
      overflow: "hidden",
    },
    handle: {
      alignSelf: "center",
      width: 40,
      height: 4,
      borderRadius: radius.full,
      backgroundColor: colors.border,
      marginBottom: spacing[3],
    },
    headerRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing[2] },
    // The × and any action sit level with the title's first line.
    headerButton: {
      width: HEADER_BUTTON,
      height: HEADER_BUTTON,
      marginLeft: -spacing[2],
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.full,
    },
    headerAction: { marginRight: -spacing[2] },
    headerText: {
      flex: 1,
      paddingTop: Math.max(0, (HEADER_BUTTON - 28 * scale) / 2),
    },
    pressed: { opacity: 0.6 },
    eyebrow: { marginBottom: spacing[2] },
    title: {
      fontFamily: fonts.display,
      fontSize: 22 * scale,
      lineHeight: 28 * scale,
      color: colors.foreground,
    },
    description: {
      fontFamily: fonts.base,
      fontSize: 15 * scale,
      lineHeight: 22 * scale,
      color: colors.mutedForeground,
      marginTop: spacing[1],
    },
    body: {
      paddingTop: spacing[4],
      paddingBottom: spacing[4],
      gap: spacing[4],
    },
  });
}
