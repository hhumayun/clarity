import { useSignUp } from "@clerk/clerk-expo";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";
import { authMessage } from "../../src/auth/errors";
import { AuthPage, FieldError, PasswordField } from "../../src/ui/AuthPage";
import { Button, type ButtonState } from "../../src/ui/Button";
import { Txt } from "../../src/ui/Txt";

const MIN_LENGTH = 8;

/**
 * A new address: one password, then a code by email to prove the address.
 * On the web, Clerk's bot check draws itself into the empty box under the
 * field when it needs to.
 */
export default function CreateStep() {
  const router = useRouter();
  const { email = "" } = useLocalSearchParams<{ email: string }>();
  const { isLoaded, signUp } = useSignUp();
  const [password, setPassword] = useState("");
  const [state, setState] = useState<ButtonState>("idle");
  const [error, setError] = useState("");
  const ready = password.length >= MIN_LENGTH;

  const go = async () => {
    if (!isLoaded || !ready || state !== "idle") return;
    setError("");
    setState("busy");
    try {
      await signUp.create({ emailAddress: email, password });
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setState("idle");
      router.push({ pathname: "/code", params: { email, purpose: "signup" } });
    } catch (failure) {
      setState("idle");
      setError(authMessage(failure, "Couldn't make the account. Try again."));
    }
  };

  return (
    <AuthPage title="Make your account" subtitle={email} footer={<Button label="Create account" state={state} disabled={!ready} onPress={() => void go()} />}>
      <PasswordField
        isNew
        value={password}
        onChangeText={(text) => {
          setPassword(text);
          setError("");
        }}
        autoFocus
        onSubmitEditing={() => void go()}
      />
      <Txt variant="footnote" tone="ink3" center>
        At least {MIN_LENGTH} characters.
      </Txt>
      <FieldError message={error} />
      {process.env.EXPO_OS === "web" ? <View nativeID="clerk-captcha" /> : null}
    </AuthPage>
  );
}
