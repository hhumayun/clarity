import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Magnifier } from "../src/art/Pictures";
import { AI_CHOICE } from "../src/data/ai";
import { useDevice } from "../src/state/device";
import { arriveSlow } from "../src/theme/motion";
import { useTheme } from "../src/theme/ThemeProvider";
import { edge, space } from "../src/theme/tokens";
import { Button, ButtonPair } from "../src/ui/Button";
import { tick } from "../src/ui/haptics";
import { Txt } from "../src/ui/Txt";

/**
 * Asked once, on phones that came through the opening screens before AI
 * help was a choice (or skipped them): the same page as the opening
 * screens' second, on its own. Either answer opens the app; Settings can
 * change it later.
 */
export default function AiChoice() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const setAi = useDevice((state) => state.setAi);
  const choose = (on: boolean) => {
    tick();
    setAi(on ? "on" : "off");
  };
  return (
    <View style={[styles.screen, { backgroundColor: colors.page, paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View entering={arriveSlow} style={styles.page}>
          <View style={styles.picture}>
            <Magnifier size={120} />
          </View>
          <Txt variant="title1" center accessibilityRole="header">
            {AI_CHOICE.title}
          </Txt>
          <Txt variant="callout" tone="ink2" center style={styles.body}>
            {AI_CHOICE.body}
          </Txt>
          <Txt variant="footnote" tone="ink3" center style={styles.body}>
            {AI_CHOICE.later}
          </Txt>
        </Animated.View>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space[3]) + space[2] }]}>
        <ButtonPair>
          <Button label="Not now" variant="outline" flex onPress={() => choose(false)} />
          <Button label="Turn on AI help" icon="sparkles" flex onPress={() => choose(true)} />
        </ButtonPair>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center", paddingVertical: space[6] },
  page: { alignItems: "center", gap: space[3] },
  picture: { height: 132, justifyContent: "center", marginBottom: space[2] },
  body: { maxWidth: 320, paddingHorizontal: edge },
  footer: { paddingHorizontal: edge, paddingTop: space[3] },
});
