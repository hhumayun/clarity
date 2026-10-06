import {
  NunitoSans_400Regular,
  NunitoSans_600SemiBold,
  NunitoSans_700Bold,
} from "@expo-google-fonts/nunito-sans";
import { ClerkProvider } from "@clerk/clerk-expo";
import { tokenCache } from "@clerk/clerk-expo/token-cache";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { resourceCache } from "@clerk/clerk-expo/resource-cache";
import { useFonts } from "expo-font";
import { Redirect, Stack, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, AppState, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppThemeProvider, useAppTheme } from "../src/providers/AppThemeProvider";
import { AuthProvider, useAuth } from "../src/providers/AuthProvider";
import { ToastProvider } from "../src/providers/ToastProvider";
import { startNetworkWatch } from "../src/sync/network";
import { moveDocsOutOfLists } from "../src/hooks/useNotes";
import { CACHE_VERSION, keepOnPhone, OFFLINE_MAX_AGE_MS, queryPersister, saveOfflineCopyNow } from "../src/sync/persist";
import { SyncProvider } from "../src/sync/SyncProvider";
import { fonts, textSize } from "../src/theme";

export { ErrorBoundary } from "expo-router";

WebBrowser.maybeCompleteAuthSession();
SplashScreen.preventAutoHideAsync();

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

// Offline, queries pause and keep what they have rather than failing.
startNetworkWatch();

/** The longest delay a timer can take (2^31 - 1 ms, about 24.8 days); longer ones fire at once. */
const MAX_TIMER_MS = 2 ** 31 - 1;

export default function RootLayout() {
  // Data is kept long enough to be written to the phone and read back offline,
  // but no longer than a timer can count: a 30-day keep-time fires at once,
  // and everything restored from the phone is thrown away as it arrives (seen
  // in revamp 5's web build). The copy on the phone still expires after 30 days.
  // Changes are made on the phone and queued in the outbox, which waits for a
  // connection by itself, so a mutation must never wait for one: React Query's
  // default ("online") paused every change offline, on screen too, until the
  // connection came back, and then stamped it with that later time.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { gcTime: Math.min(OFFLINE_MAX_AGE_MS, MAX_TIMER_MS) },
          mutations: { networkMode: "always" },
        },
      }),
  );
  const [loaded, error] = useFonts({
    NunitoSans_400Regular,
    NunitoSans_600SemiBold,
    NunitoSans_700Bold,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) void SplashScreen.hideAsync();
  }, [loaded]);

  // The offline copy is written at most every 30 seconds while it changes;
  // going to the background, it is written at once.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") void saveOfflineCopyNow(queryClient);
    });
    return () => subscription.remove();
  }, [queryClient]);

  if (!loaded) return null;

  if (!publishableKey) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingTitle}>Missing Clerk key</Text>
        <Text style={styles.missingBody}>
          Add EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY to mobile/.env, then restart Expo.
        </Text>
      </View>
    );
  }

  return (
    // Native gestures (a task row's swipe to done) need this at the root.
    <GestureHandlerRootView style={styles.root}>
    {/* Clerk's resource cache lets the session load with no connection. */}
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache} __experimental_resourceCache={resourceCache}>
      {/* Notes, tasks and the session are kept on the phone, so the app
          opens with them offline. */}
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: queryPersister,
          maxAge: OFFLINE_MAX_AGE_MS,
          buster: CACHE_VERSION,
          dehydrateOptions: { shouldDehydrateQuery: keepOnPhone },
        }}
        // Lists kept from before carried each note's rich text: it moves out.
        onSuccess={() => void moveDocsOutOfLists(queryClient)}
      >
        <SafeAreaProvider>
          {/* Keyboard-aware scrolling and footers that ride on the keyboard
              (react-native-keyboard-controller, included in Expo Go). */}
          <KeyboardProvider>
          <AppThemeProvider>
            <AuthProvider>
              <ToastProvider>
                <SyncProvider>
                  <RootNav />
                </SyncProvider>
              </ToastProvider>
            </AuthProvider>
          </AppThemeProvider>
          </KeyboardProvider>
        </SafeAreaProvider>
      </PersistQueryClientProvider>
    </ClerkProvider>
    </GestureHandlerRootView>
  );
}

function RootNav() {
  const { authState } = useAuth();
  const { colors, dark, onboardingDone, ready } = useAppTheme();
  const segments = useSegments();

  if (!ready || authState.type === "loading") {
    return (
      <View style={[styles.boot, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const inAuthGroup = segments[0] === "(auth)";
  const inOnboarding = segments.includes("onboarding");

  if (authState.type === "unauthenticated" && !inAuthGroup) {
    return <Redirect href="/login" />;
  }
  if (authState.type === "authenticated" && inAuthGroup) {
    return <Redirect href={onboardingDone ? "/" : "/onboarding"} />;
  }
  if (authState.type === "authenticated" && !onboardingDone && !inOnboarding) {
    return <Redirect href="/onboarding" />;
  }
  if (authState.type === "authenticated" && onboardingDone && inOnboarding) {
    return <Redirect href="/" />;
  }

  return (
    <>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  boot: { flex: 1, alignItems: "center", justifyContent: "center" },
  missing: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    backgroundColor: "#f6f2ea",
  },
  missingTitle: { fontFamily: fonts.display, fontSize: textSize.title, marginBottom: 12 },
  missingBody: { fontFamily: fonts.base, fontSize: textSize.body, textAlign: "center", color: "#655f55" },
});
