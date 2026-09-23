import React, { useMemo } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeldWhileOpen, usePresence } from "../hooks/usePresence";
import { fonts, radius, spacing, type Colors } from "../theme";
import { useAppTheme } from "../providers/AppThemeProvider";
import { layoutTransition } from "./motion";

type Props = {
  open: boolean;
  title: string;
  description?: string;
  /** A small line above the title, e.g. a task's area and date. */
  eyebrow?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
};

export function Sheet({ open, title, description, eyebrow, onClose, children }: Props) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);

  // Mounted only while open or animating out: a Modal left in the tree after
  // closing keeps a transparent window that swallows every touch under the
  // new renderer (RN clears it only from an old-renderer event).
  const { mounted, progress } = usePresence(open);
  // Keep showing what was there while it slides away.
  const shown = useHeldWhileOpen(open, { title, description, eyebrow, children });

  // Slide by the sheet's own height once known; until then, off the screen.
  const sheetHeight = useSharedValue(windowHeight);
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * sheetHeight.value }],
  }));

  if (!mounted) return null;

  return (
    // The Modal itself does not animate: its built-in "slide" moved the dim
    // backdrop up with the sheet, like a dark wall rising. Here the backdrop
    // fades while the sheet slides.
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={styles.fill} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View
          style={sheetStyle}
          onLayout={(event) => {
            sheetHeight.value = event.nativeEvent.layout.height;
          }}
        >
          {/* Its own layer, so a change of height between faces glides
              rather than jumps, without fighting the slide above. */}
          <Animated.View
            layout={layoutTransition}
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing[4]) }]}
          >
            <View style={styles.handle} />
            {shown.eyebrow ? <View style={styles.eyebrow}>{shown.eyebrow}</View> : null}
            <Text style={styles.title}>{shown.title}</Text>
            {shown.description ? <Text style={styles.description}>{shown.description}</Text> : null}
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
              {shown.children}
            </ScrollView>
          </Animated.View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    flex: { flex: 1, justifyContent: "flex-end" },
    backdrop: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: "rgba(30, 28, 25, 0.4)",
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
    eyebrow: { marginBottom: spacing[2] },
    title: {
      fontFamily: fonts.display,
      fontSize: 22 * scale,
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
