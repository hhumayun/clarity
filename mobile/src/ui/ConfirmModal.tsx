import React, { useMemo } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useHeldWhileOpen, usePresence } from "../hooks/usePresence";
import { MOTION } from "./motion";
import { fonts, radius, spacing, type Colors } from "../theme";
import { useAppTheme } from "../providers/AppThemeProvider";
import { Button } from "./Button";

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive,
  loading,
  onConfirm,
  onClose,
}: Props) {
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);

  // See Sheet: a hidden Modal left mounted keeps eating touches under the new
  // renderer, so a closed dialog is unmounted once its exit has played.
  const { mounted, progress } = usePresence(open, { enterMs: MOTION.base, exitMs: MOTION.fast });
  const shown = useHeldWhileOpen(open, { title, description });
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.96 + 0.04 * progress.value }],
  }));

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={styles.dismiss} onPress={onClose} accessibilityLabel="Close" />
        <Animated.View style={[styles.card, cardStyle]}>
          <Text style={styles.title}>{shown.title}</Text>
          <Text style={styles.description}>{shown.description}</Text>
          <View style={styles.actions}>
            <Button variant="ghost" style={styles.action} onPress={onClose} disabled={loading}>
              {cancelLabel}
            </Button>
            <Button
              variant={destructive ? "destructive" : "primary"}
              style={styles.action}
              loading={loading}
              onPress={onConfirm}
            >
              {confirmLabel}
            </Button>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(28, 27, 25, 0.45)",
      justifyContent: "center",
      padding: spacing[6],
    },
    dismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: spacing[6],
      gap: spacing[3],
    },
    title: {
      fontFamily: fonts.display,
      fontSize: 22 * scale,
      color: colors.foreground,
    },
    description: {
      fontFamily: fonts.base,
      fontSize: 16 * scale,
      lineHeight: 24 * scale,
      color: colors.mutedForeground,
    },
    actions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: spacing[2],
      marginTop: spacing[2],
    },
    action: {
      flexGrow: 0,
      paddingHorizontal: spacing[4],
    },
  });
}
