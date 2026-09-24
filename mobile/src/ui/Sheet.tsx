import { X } from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
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
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeldWhileOpen, usePresence } from "../hooks/usePresence";
import { EASE_OUT, MOTION } from "./motion";
import { fonts, radius, spacing, type Colors } from "../theme";
import { useAppTheme } from "../providers/AppThemeProvider";

type Props = {
  open: boolean;
  title: string;
  description?: string;
  /** A small line above the title, e.g. a task's area and date. */
  eyebrow?: React.ReactNode;
  /** Closes the sheet: the × button, dragging it down, or tapping outside it. */
  onClose: () => void;
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

export function Sheet({ open, title, description, eyebrow, onClose, onBack, headerAction, children }: Props) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);

  // Mounted only while open or animating out: a Modal left in the tree after
  // closing keeps a transparent window that swallows every touch under the
  // new renderer (RN clears it only from an old-renderer event).
  const { mounted, progress } = usePresence(open);
  // Keep showing what was there while it slides away.
  const shown = useHeldWhileOpen(open, { title, description, eyebrow, headerAction, children });

  // Slide by the sheet's own height once known; until then, off the screen.
  const sheetHeight = useSharedValue(windowHeight);
  // How far a finger has pulled the sheet down. The backdrop lightens with it.
  const dragY = useSharedValue(0);
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value * (1 - Math.min(1, dragY.value / Math.max(1, sheetHeight.value))),
  }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * sheetHeight.value + dragY.value }],
  }));
  useEffect(() => {
    if (open) dragY.value = 0;
  }, [open, dragY]);

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
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={styles.fill} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>
        {/* The sliding view is the sheet itself, a direct child of the
            keyboard-avoiding view, so its 88% limit is measured against the
            space the keyboard leaves. Wrapped in another view, the limit was
            88% of the sheet's own height: every sheet lost its last eighth
            and stopped short of the bottom of the screen.

            No layout animation on the sheet itself: it is pinned to the
            bottom, and animating its frame let the screen behind show
            through while its contents had already moved. A new face fades
            in instead. */}
        <GestureDetector gesture={pull}>
        <Animated.View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing[4]) }, sheetStyle]}
          onLayout={(event) => {
            sheetHeight.value = event.nativeEvent.layout.height;
          }}
        >
          <View
            onLayout={(event) => {
              const { y, height } = event.nativeEvent.layout;
              headerBottom.value = y + height;
            }}
          >
            <View style={styles.handle} />
            <View style={styles.headerRow}>
              <Pressable
                onPress={onClose}
                hitSlop={8}
                style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <X size={22} color={colors.foreground} />
              </Pressable>
              <View style={styles.headerText}>
                {shown.eyebrow ? <View style={styles.eyebrow}>{shown.eyebrow}</View> : null}
                <Text style={styles.title}>{shown.title}</Text>
              </View>
              {shown.headerAction ? <View style={styles.headerAction}>{shown.headerAction}</View> : null}
            </View>
            {shown.description ? <Text style={styles.description}>{shown.description}</Text> : null}
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
            >
              {shown.children}
            </Animated.ScrollView>
          </GestureDetector>
        </Animated.View>
        </GestureDetector>
      </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const HEADER_BUTTON = 36;

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
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      maxHeight: "88%",
      paddingHorizontal: spacing[6],
      paddingTop: spacing[3],
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
