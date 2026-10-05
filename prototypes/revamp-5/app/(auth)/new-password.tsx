import { useSignIn } from "@clerk/clerk-expo";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { authMessage } from "../../src/auth/errors";
import { nextStep, pause } from "../../src/auth/finish";
import { AuthPage, FieldError, PasswordField } from "../../src/ui/AuthPage";
import { Button, type ButtonState } from "../../src/ui/Button";
import { Txt } from "../../src/ui/Txt";

const MIN_LENGTH = 8;

/** After the reset code: the new password, and straight in. Other phones signed in are signed out. */
export default function NewPasswordStep() {
  const router = useRouter();
  const { email = "" } = useLocalSearchParams<{ email: string }>();
  const { isLoaded, signIn, setActive } = useSignIn();
  const [password, setPassword] = useState("");
  const [state, setState] = useState<ButtonState>("idle");
  const [error, setError] = useState("");
  const ready = password.length >= MIN_LENGTH;

  const go = async () => {
    if (!isLoaded || !ready || state !== "idle") return;
    setError("");
    setState("busy");
    try {
      const result = await signIn.resetPassword({ password, signOutOfOtherSessions: true });
      const next = await nextStep(result);
      if (next.kind === "complete") {
        setState("done");
        await pause(450);
        await setActive({ session: next.session });
      } else if (next.kind === "second") {
        setState("idle");
        router.replace({ pathname: "/code", params: { email, purpose: "second" } });
      } else {
        setState("idle");
        setError(next.message);
      }
    } catch (failure) {
      setState("idle");
      setError(authMessage(failure, "Couldn't save the new password. Try again."));
    }
  };

  return (
    <AuthPage title="Choose a new password" subtitle={email} footer={<Button label="Save and sign in" state={state} disabled={!ready} onPress={() => void go()} />}>
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
    </AuthPage>
  );
}
