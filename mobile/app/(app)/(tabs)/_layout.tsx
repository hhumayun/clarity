import { Tabs } from "expo-router";
import { Profiler } from "react";
import { perfRecord } from "../../../src/lib/perf";
import { Feather, LayoutDashboard } from "lucide-react-native";
import { TASKS_ENABLED } from "../../../src/featureFlags";
import { useAppTheme } from "../../../src/providers/AppThemeProvider";
import { fonts, textSize } from "../../../src/theme";

export default function TabsLayout() {
  const { colors, scale } = useAppTheme();
  return (
    // Timed: these stay mounted under an open note, and redraw as it saves.
    <Profiler id="tabs" onRender={recordTabsRender}>
    <Tabs
      screenOptions={{
        headerShown: false,
        // No cross-fade between tabs. It animates each screen's opacity on
        // the native thread, and a detached tab screen could come back with
        // that opacity lost — a blank screen after navigating away and back.
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        // With Life Center hidden, Notes is the only destination — a one-tab
        // bar is just wasted space.
        tabBarStyle: TASKS_ENABLED
          ? {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
            }
          : { display: "none" },
        tabBarLabelStyle: {
          fontFamily: fonts.baseSemi,
          fontSize: textSize.label * scale,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Notes",
          tabBarIcon: ({ color, size }) => <Feather color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="life-center"
        options={{
          href: TASKS_ENABLED ? undefined : null,
          title: "Life Center",
          tabBarIcon: ({ color, size }) => <LayoutDashboard color={color} size={size} />,
        }}
      />
    </Tabs>
    </Profiler>
  );
}

/** How long each redraw of the tab screens took, for the timing log. */
function recordTabsRender(_id: string, _phase: string, actualDuration: number) {
  perfRecord("Notes & Life Center render", actualDuration);
}
