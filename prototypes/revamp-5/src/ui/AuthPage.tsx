import { useRouter } from "expo-router";
import React, { useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View, type TextInputProps } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { duration } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { edge, space } from "../theme/tokens";
import { Icon } from "./Icon";
import { TextField } from "./Sheet";
import { Txt } from "./Txt";

/**
 * One step of signing in or making an account, the way Rosebud's sign-up
 * page sits: the title centred with a line under it, white wells for the
 * fields, and the step's one button at the foot, riding up with the
 * keyboard. A back chevron when there is somewhere to go back to.
 */
export function AuthPage({ title, subtitle, children, footer }: { title: string; subtitle?: string; children?: React.ReactNode; footer?: React.ReactNode }) {
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={[styles.screen, { backgroundColor: colors.page }]} behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}>
      <View style={[styles.bar, { paddingTop: insets.top + space[1] }]}>
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
            {({ pressed }) => (
              <View style={{ opacity: pressed ? 0.5 : 1 }}>
                <Icon name="back" size={24} color={colors.ink} weight="semibold" />
              </View>
            )}
          </Pressable>
        ) : null}
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.heading}>
          <Txt variant="title1" center accessibilityRole="header">
            {title}
          </Txt>
          {subtitle ? (
            <Txt variant="callout" tone="ink2" center>
              {subtitle}
            </Txt>
          ) : null}
        </View>
        {children}
      </ScrollView>
      {footer ? <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space[3]) + space[2] }]}>{footer}</View> : null}
    </KeyboardAvoidingView>
  );
}

/** What went wrong, said under the field it belongs to, in a sentence. */
export function FieldError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <Animated.View entering={FadeIn.duration(duration.base)} exiting={FadeOut.duration(duration.quick)} accessibilityLiveRegion="polite">
      <Txt variant="footnote" tone="danger" center>
        {message}
      </Txt>
    </Animated.View>
  );
}

/** A password well with an eye to show what's been typed. */
export function PasswordField({ isNew, ...rest }: TextInputProps & { isNew?: boolean }) {
  const { colors } = useTheme();
  const [shown, setShown] = useState(false);
  return (
    <View>
      <TextField
        secureTextEntry={!shown}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={isNew ? "new-password" : "current-password"}
        textContentType={isNew ? "newPassword" : "password"}
        placeholder={isNew ? "A new password" : "Password"}
        accessibilityLabel="Password"
        returnKeyType="go"
        {...rest}
        style={styles.password}
      />
      <Pressable onPress={() => setShown((value) => !value)} hitSlop={8} accessibilityRole="button" accessibilityLabel={shown ? "Hide password" : "Show password"} style={styles.eye}>
        <Icon name={shown ? "eyeOff" : "eye"} size={20} color={colors.ink3} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { minHeight: 52, paddingHorizontal: edge - 4, justifyContent: "flex-end" },
  back: { width: 44, height: 44, justifyContent: "center" },
  content: { flexGrow: 1, paddingHorizontal: edge + 4, paddingTop: space[6], gap: space[4] },
  heading: { gap: space[2], paddingBottom: space[3] },
  footer: { paddingHorizontal: edge, paddingTop: space[3], gap: space[2] },
  password: { paddingRight: 52 },
  eye: { position: "absolute", right: 0, top: 0, bottom: 0, width: 52, alignItems: "center", justifyContent: "center" },
});
