import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View, type LayoutRectangle, type StyleProp, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import { useTheme } from "../theme/ThemeProvider";
import { radius } from "../theme/tokens";
import { Chip } from "./Chip";
import { useStretchTo } from "./stretch";

export type ChipChoice<T> = { label: string; value: T };

// Room kept beside a chip scrolled into view.
const MARGIN = 16;

/**
 * A row of choices with one ink ring that travels from the chosen chip to the
 * next, stretching toward it and gathering on landing, as the week strip's
 * ring does (it jumped, chip to chip, before). The chosen label inks at once;
 * a choice near the edge scrolls fully into view. Chips vary in width, so the
 * ring is measured to each.
 */
export function ChipRow<T>({ choices, chosen, onChoose, contentStyle, testID }: { choices: ChipChoice<T>[]; chosen: T; onChoose: (value: T) => void; contentStyle?: StyleProp<ViewStyle>; testID?: string }) {
  const { colors } = useTheme();
  const scroller = useRef<ScrollView>(null);
  const [layouts, setLayouts] = useState<Record<string, LayoutRectangle>>({});
  // Where the row is scrolled to, and how wide it shows: read when a choice changes.
  const viewX = useRef(0);
  const viewWidth = useRef(0);
  const index = choices.findIndex((choice) => Object.is(choice.value, chosen));
  const at = index >= 0 ? layouts[choices[index].label] : undefined;
  const ring = useStretchTo(at?.x ?? 0, at?.width ?? 0);

  // A choice near either edge comes fully into view.
  useEffect(() => {
    if (!at || viewWidth.current === 0) return;
    if (at.x - MARGIN < viewX.current) scroller.current?.scrollTo({ x: Math.max(0, at.x - MARGIN), animated: true });
    else if (at.x + at.width + MARGIN > viewX.current + viewWidth.current) scroller.current?.scrollTo({ x: at.x + at.width + MARGIN - viewWidth.current, animated: true });
    // Only when the choice changes, not as the row scrolls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, at?.x]);

  return (
    <ScrollView
      ref={scroller}
      testID={testID}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={contentStyle}
      onLayout={(event) => (viewWidth.current = event.nativeEvent.layout.width)}
      onScroll={(event) => (viewX.current = event.nativeEvent.contentOffset.x)}
      scrollEventThrottle={64}
    >
      {choices.map((choice) => (
        <View
          key={choice.label}
          onLayout={(event) => {
            const layout = event.nativeEvent.layout;
            setLayouts((all) => (all[choice.label] && all[choice.label].x === layout.x && all[choice.label].width === layout.width ? all : { ...all, [choice.label]: layout }));
          }}
        >
          <Chip label={choice.label} selected={Object.is(choice.value, chosen)} ringless onPress={() => onChoose(choice.value)} />
        </View>
      ))}
      {at ? <Animated.View pointerEvents="none" testID={testID ? `${testID}-ring` : undefined} style={[styles.ring, { top: at.y, height: at.height, borderColor: colors.ink }, ring]} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  ring: { position: "absolute", left: 0, borderWidth: 1.5, borderRadius: radius.pill, borderCurve: "continuous" },
});
