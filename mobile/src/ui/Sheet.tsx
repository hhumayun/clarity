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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts, radius, spacing, type Colors } from "../theme";
import { useAppTheme } from "../providers/AppThemeProvider";

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
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);

  // Unmount when closed rather than leaving a hidden Modal in the tree. RN
  // only clears a Modal's internal isRendered flag from the native
  // "modalDismissed" event, which its own source notes is "for the old
  // renderer in iOS only" — so under the new renderer a Modal that has been
  // opened once keeps rendering a transparent full-screen window, which
  // silently swallows every touch on the screen behind it.
  if (!open) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing[4]) }]}>
          <View style={styles.handle} />
          {eyebrow ? <View style={styles.eyebrow}>{eyebrow}</View> : null}
          <Text style={styles.title}>{title}</Text>
          {description ? <Text style={styles.description}>{description}</Text> : null}
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            {children}
          </ScrollView>
        </View>
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
