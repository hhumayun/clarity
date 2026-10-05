import { useSignIn, useSignUp } from "@clerk/clerk-expo";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { authMessage } from "../../src/auth/errors";
import { emailAddressIdFor, nextStep, pause } from "../../src/auth/finish";
import { space } from "../../src/theme/tokens";
import { useAcknowledge } from "../../src/ui/Acknowledgement";
import { AuthPage, FieldError } from "../../src/ui/AuthPage";
import { Button } from "../../src/ui/Button";
import { CodeBoxes, type CodeState } from "../../src/ui/CodeBoxes";

type Purpose = "signup" | "signin" | "second" | "reset";

/** How long before "Send a new code" wakes up, so a slow email isn't sent twice. */
const RESEND_AFTER_MS = 30_000;

/**
 * The code Clerk emailed, for any of the four reasons it sends one: proving
 * a new address, signing in without the password, a second step, or setting
 * a new password. It goes as soon as the sixth digit is in.
 */
export default function CodeStep() {
  const router = useRouter();
  const { email = "", purpose = "signup" } = useLocalSearchParams<{ email: string; purpose: Purpose }>();
  const acknowledge = useAcknowledge();
  const signIn = useSignIn();
  const signUp = useSignUp();
  const [code, setCode] = useState("");
  const [state, setState] = useState<CodeState>("idle");
  const [error, setError] = useState("");
  const [sentAt, setSentAt] = useState(() => Date.now());
  const [canResend, setCanResend] = useState(false);

  useEffect(() => {
    setCanResend(false);
    const timer = setTimeout(() => setCanResend(true), RESEND_AFTER_MS);
    return () => clearTimeout(timer);
  }, [sentAt]);

  const wrong = (failure: unknown) => {
    setState("wrong");
    setError(authMessage(failure, "That code didn't work. Try again."));
    setTimeout(() => {
      setCode("");
      setState("idle");
    }, 450);
  };

  const enter = async (session: string | null, setActive: (params: { session: string | null }) => Promise<void>) => {
    setState("done");
    await pause(550);
    await setActive({ session });
  };

  const submit = async (digits: string) => {
    if (!signIn.isLoaded || !signUp.isLoaded || state === "busy" || state === "done") return;
    setError("");
    setState("busy");
    try {
      if (purpose === "signup") {
        const result = await signUp.signUp.attemptEmailAddressVerification({ code: digits });
        if (result.status === "complete") await enter(result.createdSessionId, signUp.setActive);
        else wrong(new Error("The account needs one more thing before it can open. Try again."));
        return;
      }
      if (purpose === "reset") {
        const result = await signIn.signIn.attemptFirstFactor({ strategy: "reset_password_email_code", code: digits });
        if (String(result.status) === "needs_new_password") {
          setState("done");
          await pause(400);
          router.replace({ pathname: "/new-password", params: { email } });
        } else wrong(new Error("That code didn't work. Try again."));
        return;
      }
      const result =
        purpose === "second"
          ? await signIn.signIn.attemptSecondFactor({ strategy: "email_code", code: digits })
          : await signIn.signIn.attemptFirstFactor({ strategy: "email_code", code: digits });
      const next = await nextStep(result);
      if (next.kind === "complete") await enter(next.session, signIn.setActive);
      else if (next.kind === "second") {
        setState("idle");
        setCode("");
        router.replace({ pathname: "/code", params: { email, purpose: "second" } });
      } else wrong(new Error(next.message));
    } catch (failure) {
      wrong(failure);
    }
  };

  const resend = async () => {
    if (!signIn.isLoaded || !signUp.isLoaded) return;
    setError("");
    setSentAt(Date.now());
    try {
      const attempt = signIn.signIn;
      if (purpose === "signup") await signUp.signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      else if (purpose === "reset") await attempt.prepareFirstFactor({ strategy: "reset_password_email_code", emailAddressId: emailAddressIdFor(attempt.supportedFirstFactors, "reset_password_email_code") ?? "" });
      else if (purpose === "signin") await attempt.prepareFirstFactor({ strategy: "email_code", emailAddressId: emailAddressIdFor(attempt.supportedFirstFactors, "email_code") ?? "" });
      else await attempt.prepareSecondFactor({ strategy: "email_code", emailAddressId: emailAddressIdFor(attempt.supportedSecondFactors, "email_code") });
      acknowledge("A new code is on its way", "mail");
    } catch (failure) {
      setError(authMessage(failure, "Couldn't send a new code. Try again in a moment."));
    }
  };

  return (
    <AuthPage title="Check your email" subtitle={`We sent a code to ${email}.`}>
      <CodeBoxes value={code} onChange={(next) => (setCode(next), setError(""))} onFilled={(digits) => void submit(digits)} state={state} />
      <FieldError message={error} />
      <View style={styles.resend}>
        <Button label="Send a new code" variant="plain" size="sm" disabled={!canResend || state === "done"} onPress={() => void resend()} />
      </View>
    </AuthPage>
  );
}

const styles = StyleSheet.create({
  resend: { alignItems: "center", paddingTop: space[2] },
});
