import type { useSignIn } from "@clerk/clerk-expo";

type SignIn = NonNullable<ReturnType<typeof useSignIn>["signIn"]>;

/** Where a sign-in stands after a password or a code was accepted. */
export type Next = { kind: "complete"; session: string | null } | { kind: "second" } | { kind: "stuck"; message: string };

/** The address id Clerk wants with a code it emails, for one strategy. */
export function emailAddressIdFor(factors: readonly { strategy: string }[] | null | undefined, strategy: string): string | undefined {
  const factor = factors?.find((candidate) => candidate.strategy === strategy) as { emailAddressId?: string } | undefined;
  return factor?.emailAddressId;
}

export function offers(factors: readonly { strategy: string }[] | null | undefined, strategy: string): boolean {
  return !!factors?.some((candidate) => candidate.strategy === strategy);
}

/**
 * In, or one more step. A second step is only taken when Clerk can email a
 * code for it (two-step sign-in, or a new device that has to be trusted);
 * anything else is said plainly rather than left hanging.
 */
export async function nextStep(result: SignIn): Promise<Next> {
  const status = String(result.status);
  if (status === "complete") return { kind: "complete", session: result.createdSessionId };
  if ((status === "needs_second_factor" || status === "needs_client_trust") && offers(result.supportedSecondFactors, "email_code")) {
    await result.prepareSecondFactor({ strategy: "email_code", emailAddressId: emailAddressIdFor(result.supportedSecondFactors, "email_code") });
    return { kind: "second" };
  }
  return { kind: "stuck", message: "Signing in needs a step this app can't do yet. Try Continue with Google, or reset your password." };
}

/** Long enough for a check to be seen before the screen moves on. */
export const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
