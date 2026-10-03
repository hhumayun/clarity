import { Stack } from "expo-router";
import { useAppTheme } from "../../src/providers/AppThemeProvider";
import { TASKS_ENABLED } from "../../src/featureFlags";
import { Reminders } from "../../src/providers/Reminders";

export default function AppLayout() {
  const { colors } = useAppTheme();
  return (
    <>
      {/* Task reminders: kept in step with the tasks, and answered. */}
      {TASKS_ENABLED ? <Reminders /> : null}
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
        {/* A task, with everything about it: a screen of its own, like a
            note, swiped back to close. */}
        <Stack.Screen name="task/[id]" />
        {/* Developer only: the rich text candidates side by side. */}
        <Stack.Screen name="editor-lab" />
        <Stack.Screen
          name="catch-up"
          options={{ presentation: "fullScreenModal", animation: "slide_from_bottom" }}
        />
      </Stack>
    </>
  );
}
