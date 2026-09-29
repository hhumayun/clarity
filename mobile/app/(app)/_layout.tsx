import { Stack } from "expo-router";
import { useAppTheme } from "../../src/providers/AppThemeProvider";

export default function AppLayout() {
  const { colors } = useAppTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="note/[id]" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="privacy" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen
        name="focus/[taskId]"
        options={{ presentation: "fullScreenModal", animation: "slide_from_bottom", gestureEnabled: false }}
      />
      {/* A task's notes and summary: a dialog that slides up over whatever
          opened it (an iOS page sheet), dragged down to close. */}
      <Stack.Screen name="task/[id]" options={{ presentation: "modal" }} />
      <Stack.Screen
        name="catch-up"
        options={{ presentation: "fullScreenModal", animation: "slide_from_bottom" }}
      />
    </Stack>
  );
}
