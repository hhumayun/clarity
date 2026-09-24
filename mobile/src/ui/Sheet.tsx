import { X } from "lucide-react-native";
import React, { useEffect, useMemo, useRef } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
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

// Dragged down this far (or flicked down), the sheet closes; any less and
// it springs back.
const CLOSE_DRAG = 120;
const CLOSE_FLICK = 0.9;

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
  // The handle and title are the grip. Only a mostly-downward drag takes it,
  // so taps still reach the buttons there, and the list below keeps its own
  // scrolling.
  const grip = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_, g) => {
          dragY.value = Math.max(0, g.dy);
        },
        onPanResponderRelease: (_, g) => {
          if (g.dy > Math.min(CLOSE_DRAG, sheetHeight.value * 0.3) || (g.vy > CLOSE_FLICK && g.dy > 12)) {
            // Slides on down from where the finger left it.
            onCloseRef.current();
          } else {
            dragY.value = withTiming(0, { duration: MOTION.base, easing: EASE_OUT });
          }
        },
        onPanResponderTerminate: () => {
          dragY.value = withTiming(0, { duration: MOTION.base, easing: EASE_OUT });
        },
      }),
    [dragY, sheetHeight],
  );

  if (!mounted) return null;

  return (
    // The Modal itself does not animate: its built-in "slide" moved the dim
    // backdrop up with the sheet, like a dark wall rising. Here the backdrop
    // fades while the sheet slides.
    <Modal visible transparent animationType="none" onRequestClose={onBack ?? onClose}>
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
        <Animated.View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing[4]) }, sheetStyle]}
          onLayout={(event) => {
            sheetHeight.value = event.nativeEvent.layout.height;
          }}
        >
          <View {...grip.panHandlers}>
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
          {/* Dragging the list down pulls the keyboard down with it, and the
              sheet settles back to the bottom. */}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            contentContainerStyle={styles.body}
          >
            {shown.children}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
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
