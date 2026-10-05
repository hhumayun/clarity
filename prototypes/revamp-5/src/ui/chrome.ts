import { useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";

/** Only iOS blurs what's behind a veil; elsewhere the veil is solid so page text can't show through. */
export const frosted = process.env.EXPO_OS === "ios";

/** The scroll offset of a page, for bars that draw a hairline once content has scrolled under them. */
export function useScrollY() {
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = Math.max(0, event.contentOffset.y);
    },
  });
  return { onScroll, scrollY };
}
