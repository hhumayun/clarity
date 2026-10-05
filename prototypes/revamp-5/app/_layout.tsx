import { ClerkProvider } from "@clerk/clerk-expo";
import { resourceCache } from "@clerk/clerk-expo/resource-cache";
import { tokenCache } from "@clerk/clerk-expo/token-cache";
import {
  NunitoSans_400Regular,
  NunitoSans_400Regular_Italic,
  NunitoSans_500Medium,
  NunitoSans_600SemiBold,
  NunitoSans_700Bold,
  NunitoSans_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/nunito-sans";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { FadeOut, useReducedMotion, withTiming } from "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { moveDocsOutOfLists } from "../src/core/hooks/useNotes";
import { AuthProvider, useAuth } from "../src/core/providers/AuthProvider";
import { ToastProvider } from "../src/core/providers/ToastProvider";
import { startNetworkWatch } from "../src/core/sync/network";
import { CACHE_VERSION, keepOnPhone, OFFLINE_MAX_AGE_MS, queryPersister, saveOfflineCopyNow } from "../src/core/sync/persist";
import { SyncProvider } from "../src/core/sync/SyncProvider";
import { useDevice } from "../src/state/device";
import { duration, easeOut } from "../src/theme/motion";
import { ThemeProvider, useTheme } from "../src/theme/ThemeProvider";
import { light, space, type } from "../src/theme/tokens";
import { AcknowledgementProvider } from "../src/ui/Acknowledgement";
import { LaunchMark } from "../src/ui/LaunchMark";
import { TaskMenuProvider } from "../src/ui/TaskMenu";

export { ErrorBoundary } from "../src/ui/ErrorBoundary";

// Google sign-in on the web finishes in a popup that hands the result back here.
WebBrowser.maybeCompleteAuthSession();
void SplashScreen.preventAutoHideAsync();
// Offline, queries pause and keep what they have rather than failing.
startNetworkWatch();

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

// The web build only: browsers ring a focused text field; the caret in the accent is enough.
if (process.env.EXPO_OS === "web" && typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = "input:focus, textarea:focus { outline: none; }";
  document.head.appendChild(style);
}

/** A note or Focus opened by link lands with the tabs underneath, so Back and Done always have somewhere to go. */
export const unstable_settings = { anchor: "(tabs)" };

export default function RootLayout() {
  // Data is kept long enough to be written to the phone and read back offline.
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { gcTime: OFFLINE_MAX_AGE_MS } } }));
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
  // The offline copy is written at most every 30 seconds while it changes, and at once on going to the background.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") void saveOfflineCopyNow(queryClient);
    });
    return () => subscription.remove();
  }, [queryClient]);

  if (!loaded) return null;
  if (!publishableKey) return <MissingKey />;
  return (
    <GestureHandlerRootView style={styles.flex}>
      {/* Clerk's resource cache lets a saved session open with no connection. */}
      <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache} __experimental_resourceCache={resourceCache}>
        {/* Notes, tasks and the session are kept on the phone, so the app opens with them offline. */}
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{ persister: queryPersister, maxAge: OFFLINE_MAX_AGE_MS, buster: CACHE_VERSION, dehydrateOptions: { shouldDehydrateQuery: keepOnPhone } }}
          onSuccess={() => void moveDocsOutOfLists(queryClient)}
        >
          <SafeAreaProvider>
            <ThemeProvider>
              <AcknowledgementProvider>
                <ToastProvider>
                  <AuthProvider>
                    <SyncProvider>
                      <TaskMenuProvider>
                        <Navigator />
                      </TaskMenuProvider>
                    </SyncProvider>
                  </AuthProvider>
                </ToastProvider>
              </AcknowledgementProvider>
            </ThemeProvider>
          </SafeAreaProvider>
        </PersistQueryClientProvider>
      </ClerkProvider>
    </GestureHandlerRootView>
  );
}

const sheet = {
  presentation: "formSheet" as const,
  sheetGrabberVisible: true,
  sheetCornerRadius: 28,
  sheetExpandsWhenScrolledToEdge: true,
};

/** If a session check never answers (Clerk can't load on a first launch offline), the welcome shows after this long. */
const PATIENCE_MS = 8_000;

/**
 * Three doors, one open at a time. Signed out and not looking around: the
 * welcome and the steps of signing in. Signed in for the first time on this
 * phone: the first-run pages. Otherwise the app itself, which until real
 * data arrives shows the sample notes (and is all there is in demo). Doors
 * swap by guard, so Back can never return through one.
 */
function Navigator() {
  const { colors, dark } = useTheme();
  const { authState } = useAuth();
  const hydrated = useDevice((state) => state.hydrated);
  const demo = useDevice((state) => state.demo);
  const onboarded = useDevice((state) => state.onboarded);
  const [patience, setPatience] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setPatience(true), PATIENCE_MS);
    return () => clearTimeout(timer);
  }, []);
  // Known once, known for good: signing in later must never take the navigator down.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (hydrated && (authState.type !== "loading" || patience)) setReady(true);
  }, [hydrated, authState.type, patience]);

  const signedIn = authState.type === "authenticated";
  const inApp = signedIn ? onboarded : demo;
  const firstRun = signedIn && !onboarded;
  const outside = !inApp && !firstRun;

  return (
    <>
      <StatusBar style={dark ? "light" : "dark"} />
      {/* Mounted only once the session is known, so a link the app was opened with (a note, a reminder's task) is kept rather than bounced by a guard that hadn't decided yet. */}
      {ready ? (
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.page } }}>
          <Stack.Protected guard={inApp}>
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
          </Stack.Protected>
          <Stack.Protected guard={firstRun}>
            <Stack.Screen name="first-run" options={{ animation: "fade" }} />
          </Stack.Protected>
          <Stack.Protected guard={outside}>
            <Stack.Screen name="(auth)" options={{ animation: "fade" }} />
          </Stack.Protected>
        </Stack>
      ) : null}
      <LaunchVeil ready={ready} />
    </>
  );
}

/**
 * The one launch moment: a leaf in your colour grows in over the name, and
 * the veil lifts once the session is known, after about a second at least.
 * It only ever shows at launch. Under Reduce Motion it waits without
 * growing and leaves by fading.
 */
function LaunchVeil({ ready }: { ready: boolean }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [waited, setWaited] = useState(false);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), reduced ? 0 : 900);
    return () => clearTimeout(timer);
  }, [reduced]);
  useEffect(() => {
    if (ready && waited) setGone(true);
  }, [ready, waited]);
  if (gone) return null;
  const lift = () => {
    "worklet";
    const timing = { duration: duration.enter, easing: easeOut };
    return {
      initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
      animations: { opacity: withTiming(0, timing), transform: [{ translateY: withTiming(-24, timing) }] },
    };
  };
  return (
    <Animated.View exiting={reduced ? FadeOut.duration(duration.quick) : lift} style={[StyleSheet.absoluteFill, styles.veil, { backgroundColor: colors.page }]}>
      {reduced ? null : <LaunchMark />}
    </Animated.View>
  );
}

function MissingKey() {
  return (
    <View style={[styles.flex, styles.veil, { backgroundColor: light.page, padding: space[8], gap: space[3] }]}>
      <Text style={[type.title2, { color: light.ink }]}>Missing Clerk key</Text>
      <Text style={[type.callout, { color: light.ink2, textAlign: "center" }]}>Add EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY to revamp 5's .env, then restart Expo.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  veil: { alignItems: "center", justifyContent: "center" },
});
