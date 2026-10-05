import { useSignIn } from "@clerk/clerk-expo";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { authMessage } from "../../src/auth/errors";
import { emailAddressIdFor, nextStep, offers, pause } from "../../src/auth/finish";
import { space } from "../../src/theme/tokens";
import { AuthPage, FieldError, PasswordField } from "../../src/ui/AuthPage";
import { Button, type ButtonState } from "../../src/ui/Button";

/**
 * A known address: its password, and two ways round it. "Forgot password?"
 * emails a code to set a new one; "Email me a code" signs in with a code
 * instead, when the account allows it.
 */
export default function PasswordStep() {
  const router = useRouter();
  const { email = "" } = useLocalSearchParams<{ email: string }>();
  const { isLoaded, signIn, setActive } = useSignIn();
  const [password, setPassword] = useState("");
  const [state, setState] = useState<ButtonState>("idle");
  const [helping, setHelping] = useState<"reset" | "code" | null>(null);
  const [error, setError] = useState("");
  const factors = signIn?.supportedFirstFactors;

  const go = async () => {
    if (!isLoaded || !password || state !== "idle") return;
    setError("");
    setState("busy");
    try {
      const result = await signIn.attemptFirstFactor({ strategy: "password", password });
      const next = await nextStep(result);
      if (next.kind === "complete") {
        setState("done");
        await pause(450);
        await setActive({ session: next.session });
      } else if (next.kind === "second") {
        setState("idle");
        router.push({ pathname: "/code", params: { email, purpose: "second" } });
      } else {
        setState("idle");
        setError(next.message);
      }
    } catch (failure) {
      setState("idle");
      setError(authMessage(failure, "Couldn't sign in. Try again."));
    }
  };

  const emailMe = async (purpose: "reset" | "code") => {
    if (!isLoaded || helping) return;
    const strategy = purpose === "reset" ? "reset_password_email_code" : "email_code";
    setError("");
    setHelping(purpose);
    try {
      await signIn.prepareFirstFactor({ strategy, emailAddressId: emailAddressIdFor(factors, strategy) ?? "" });
      router.push({ pathname: "/code", params: { email, purpose: purpose === "reset" ? "reset" : "signin" } });
    } catch (failure) {
      setError(authMessage(failure, "Couldn't send the email. Try again in a moment."));
    } finally {
      setHelping(null);
    }
  };

  return (
    <AuthPage title="Welcome back" subtitle={email} footer={<Button label="Sign in" state={state} disabled={!password} onPress={() => void go()} />}>
      <PasswordField
        value={password}
        onChangeText={(text) => {
          setPassword(text);
          setError("");
        }}
        autoFocus
        onSubmitEditing={() => void go()}
      />
      <FieldError message={error} />
      <View style={styles.ways}>
        {offers(factors, "reset_password_email_code") ? <Button label="Forgot password?" variant="plain" size="sm" state={helping === "reset" ? "busy" : "idle"} onPress={() => void emailMe("reset")} /> : null}
        {offers(factors, "email_code") ? <Button label="Email me a code instead" variant="plain" size="sm" state={helping === "code" ? "busy" : "idle"} onPress={() => void emailMe("code")} /> : null}
      </View>
    </AuthPage>
  );
}

const styles = StyleSheet.create({
  ways: { alignItems: "center", gap: space[1] },
});
