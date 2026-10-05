import { useSignIn } from "@clerk/clerk-expo";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { authMessage, clerkCode, looksLikeEmail } from "../../src/auth/errors";
import { emailAddressIdFor, offers } from "../../src/auth/finish";
import { AuthPage, FieldError } from "../../src/ui/AuthPage";
import { Button, type ButtonState } from "../../src/ui/Button";
import { TextField } from "../../src/ui/Sheet";

/**
 * One field for everyone. An address Clerk knows goes on to its password
 * (or to an emailed code, for an account made with Google); one it doesn't
 * goes on to making an account. Nobody has to choose "sign in" or "sign up".
 */
export default function EmailStep() {
  const router = useRouter();
  const { isLoaded, signIn } = useSignIn();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<ButtonState>("idle");
  const [error, setError] = useState("");
  const ready = looksLikeEmail(email);

  const go = async () => {
    if (!isLoaded || !ready || state !== "idle") return;
    const address = email.trim();
    setError("");
    setState("busy");
    try {
      const attempt = await signIn.create({ identifier: address });
      const factors = attempt.supportedFirstFactors;
      if (offers(factors, "password")) {
        setState("idle");
        router.push({ pathname: "/password", params: { email: address } });
      } else if (offers(factors, "email_code")) {
        await attempt.prepareFirstFactor({ strategy: "email_code", emailAddressId: emailAddressIdFor(factors, "email_code") ?? "" });
        setState("idle");
        router.push({ pathname: "/code", params: { email: address, purpose: "signin" } });
      } else {
        setState("idle");
        setError("This account signs in with Google. Go back and choose Continue with Google.");
      }
    } catch (failure) {
      setState("idle");
      if (clerkCode(failure) === "form_identifier_not_found") router.push({ pathname: "/create", params: { email: address } });
      else setError(authMessage(failure, "Something went wrong. Try again."));
    }
  };

  return (
    <AuthPage title="What's your email?" subtitle="We'll sign you in, or make you an account if you're new." footer={<Button label="Continue" state={state} disabled={!ready} onPress={() => void go()} />}>
      <TextField
        value={email}
        onChangeText={(text) => {
          setEmail(text);
          setError("");
        }}
        placeholder="you@example.com"
        autoFocus
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="go"
        onSubmitEditing={() => void go()}
        accessibilityLabel="Email"
      />
      <FieldError message={error} />
    </AuthPage>
  );
}
