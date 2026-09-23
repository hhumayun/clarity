import { Check } from "lucide-react-native";
import React, { useMemo } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { FadeIn, FadeOut, ZoomIn } from "react-native-reanimated";
import { useAppTheme } from "../providers/AppThemeProvider";
import { fonts, radius, spacing, type Colors } from "../theme";

/** How long the confirmation stays up before the screen moves on to the card. */
export const TASK_ADDED_MS = 1_100;

type Props = {
  visible: boolean;
  /** "added": "Task added to Errands". "done": "Done" over the task's words. */
  kind?: "added" | "done";
  projectName?: string;
  /** The task, shown under "Done". */
  taskText?: string;
  /** Where to sit. Defaults to filling and centring in the parent. */
  style?: StyleProp<ViewStyle>;
};

/**
 * A small card with a tick that springs in: "Task added to Errands". Not a
 * Modal on purpose — it sits inside the screen, takes no touches, and is
 * unmounted the moment it is done.
 */
export function TaskAddedOverlay({ visible, kind = "added", projectName = "", taskText = "", style }: Props) {
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  if (!visible) return null;
  return (
    <Animated.View
      pointerEvents="none"
      entering={FadeIn.duration(120)}
      exiting={FadeOut.duration(200)}
      style={[styles.fill, style]}
    >
      <Animated.View
        entering={ZoomIn.springify().damping(14).stiffness(220).mass(0.7)}
        style={styles.card}
        accessibilityLiveRegion="polite"
        accessibilityLabel={kind === "done" ? `Done: ${taskText}` : `Task added to ${projectName}`}
      >
        <View style={styles.circle}>
          <Animated.View entering={ZoomIn.delay(140).springify().damping(12).stiffness(260)}>
            <Check size={30} color={colors.primaryForeground} strokeWidth={3} />
          </Animated.View>
        </View>
        {kind === "done" ? (
          <>
            <Text style={styles.doneTitle}>Done</Text>
            {taskText ? (
              <Text style={styles.doneTask} numberOfLines={2}>
                {taskText}
              </Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.text}>
            Task added to <Text style={styles.project}>{projectName}</Text>
          </Text>
        )}
      </Animated.View>
    </Animated.View>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    fill: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing[6],
    },
    card: {
      alignItems: "center",
      gap: spacing[3],
      paddingHorizontal: spacing[6],
      paddingVertical: spacing[6],
      borderRadius: radius.lg,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: "#000",
      shadowOpacity: 0.18,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
    },
    circle: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    text: {
      fontFamily: fonts.base,
      fontSize: 17 * scale,
      color: colors.foreground,
      textAlign: "center",
    },
    project: { fontFamily: fonts.baseSemi },
    doneTitle: { fontFamily: fonts.display, fontSize: 24 * scale, color: colors.foreground },
    doneTask: {
      maxWidth: 260,
      fontFamily: fonts.base,
      fontSize: 15 * scale,
      color: colors.mutedForeground,
      textAlign: "center",
    },
  });
}
