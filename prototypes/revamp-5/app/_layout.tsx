import {
  NunitoSans_400Regular,
  NunitoSans_400Regular_Italic,
  NunitoSans_500Medium,
  NunitoSans_600SemiBold,
  NunitoSans_700Bold,
  NunitoSans_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/nunito-sans";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useReducedMotion, withTiming } from "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { duration, easeOut } from "../src/theme/motion";
import { ThemeProvider, useTheme } from "../src/theme/ThemeProvider";
import { AcknowledgementProvider } from "../src/ui/Acknowledgement";
import { LaunchMark } from "../src/ui/LaunchMark";
import { TaskMenuProvider } from "../src/ui/TaskMenu";

void SplashScreen.preventAutoHideAsync();

// The web build only: browsers ring a focused text field; the caret in the accent is enough.
if (process.env.EXPO_OS === "web" && typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = "input:focus, textarea:focus { outline: none; }";
  document.head.appendChild(style);
}

/** A note or Focus opened by link lands with the tabs underneath, so Back and Done always have somewhere to go. */
export const unstable_settings = { anchor: "(tabs)" };

export default function RootLayout() {
  const [loaded] = useFonts({
    NunitoSans_400Regular,
    NunitoSans_400Regular_Italic,
    NunitoSans_500Medium,
    NunitoSans_600SemiBold,
    NunitoSans_700Bold,
    NunitoSans_800ExtraBold,
  });
  useEffect(() => {
    if (loaded) void SplashScreen.hideAsync();
  }, [loaded]);
  if (!loaded) return null;
  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AcknowledgementProvider>
            <TaskMenuProvider>
              <Navigator />
            </TaskMenuProvider>
          </AcknowledgementProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const sheet = {
  presentation: "formSheet" as const,
  sheetGrabberVisible: true,
  sheetCornerRadius: 28,
  sheetExpandsWhenScrolledToEdge: true,
};

function Navigator() {
  const { colors, dark } = useTheme();
  return (
    <>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.page } }}>
        <Stack.Screen name="(tabs)" />
        {/* Pages you go into and come back from: pushed, with the edge swipe back. */}
        <Stack.Screen name="note/[id]" options={{ contentStyle: { backgroundColor: colors.card } }} />
        <Stack.Screen name="task/[id]" />
        <Stack.Screen name="pictures" />
        {/* Settings is a sheet with its own Done, as Rosebud's is. */}
        <Stack.Screen name="settings" options={{ presentation: "modal" }} />
        {/* Focus is its own room: full screen, entered by fading; only "Stop early" ends a session. */}
        <Stack.Screen name="focus/[taskId]" options={{ presentation: "fullScreenModal", animation: "fade", gestureEnabled: false }} />
        {/* Catch up is a self-contained task with its own close. */}
        <Stack.Screen name="catch-up" options={{ presentation: "fullScreenModal" }} />
        {/* Quick add floats over the screen it was opened from. */}
        <Stack.Screen name="quick-add" options={{ presentation: "transparentModal", animation: "fade", contentStyle: { backgroundColor: "transparent" } }} />
        {/* A note's tasks are a short interruption over the note. */}
        <Stack.Screen name="note-tasks" options={{ ...sheet, sheetAllowedDetents: [0.7, 0.96], contentStyle: { backgroundColor: colors.page } }} />
        {/* Short choices are native sheets: drag to dismiss, sized to what's in them. */}
        {["date", "time", "area"].map((name) => (
          <Stack.Screen key={name} name={`sheet/${name}`} options={{ ...sheet, sheetAllowedDetents: "fitToContents", contentStyle: { backgroundColor: colors.page } }} />
        ))}
        {["reminder", "areas", "link-note", "link-task"].map((name) => (
          <Stack.Screen key={name} name={`sheet/${name}`} options={{ ...sheet, sheetAllowedDetents: [0.62, 0.94], contentStyle: { backgroundColor: colors.page } }} />
        ))}
      </Stack>
      <LaunchVeil />
    </>
  );
}

/**
 * The one launch moment: a leaf in your colour grows in over the name, and
 * the veil lifts onto Today. About a second; skipped under Reduce Motion.
 */
function LaunchVeil() {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(!reduced);
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => setShown(false), 900);
    return () => clearTimeout(timer);
  }, [shown]);
  if (!shown) return null;
  const lift = () => {
    "worklet";
    const timing = { duration: duration.enter, easing: easeOut };
    return {
      initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
      animations: { opacity: withTiming(0, timing), transform: [{ translateY: withTiming(-24, timing) }] },
    };
  };
  return (
    <Animated.View exiting={lift} style={[StyleSheet.absoluteFill, styles.veil, { backgroundColor: colors.page }]}>
      <LaunchMark />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  veil: { alignItems: "center", justifyContent: "center" },
});
