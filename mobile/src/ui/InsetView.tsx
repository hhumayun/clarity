import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets, type Edge } from "react-native-safe-area-context";

/**
 * A screen container padded clear of the status bar, notch and home bar.
 *
 * Like SafeAreaView, but it takes the insets from the app's root provider
 * rather than measuring itself. SafeAreaView measures how far the view
 * overlaps the unsafe areas, and screens that slide up from the bottom
 * (the full-screen focus and catch-up routes) are laid out while still off
 * screen, so it measured nothing: their headers, and the buttons in them,
 * ended up under the clock and the notch.
 */
export function InsetView({
  style,
  edges = ["top", "bottom"],
  children,
}: {
  style?: StyleProp<ViewStyle>;
  edges?: Edge[];
  children?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const padding: ViewStyle = {
    paddingTop: edges.includes("top") ? insets.top : 0,
    paddingBottom: edges.includes("bottom") ? insets.bottom : 0,
    paddingLeft: edges.includes("left") ? insets.left : 0,
    paddingRight: edges.includes("right") ? insets.right : 0,
  };
  return <View style={[style, padding]}>{children}</View>;
}
