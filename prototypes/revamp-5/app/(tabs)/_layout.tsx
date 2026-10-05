import { Tabs } from "expo-router";
import React from "react";
import { useTheme } from "../../src/theme/ThemeProvider";
import { TabBar } from "../../src/ui/TabBar";

/** Four places and the + between them: Today and Notes, then Life and Search. */
export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false, animation: "none", sceneStyle: { backgroundColor: colors.page } }}>
      <Tabs.Screen name="index" options={{ title: "Today" }} />
      <Tabs.Screen name="notes" options={{ title: "Notes" }} />
      <Tabs.Screen name="life" options={{ title: "Life" }} />
      <Tabs.Screen name="search" options={{ title: "Search" }} />
    </Tabs>
  );
}
