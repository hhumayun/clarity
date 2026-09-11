import superjson from "superjson";
import { AiOutOfCreditsError, AiRateLimitError } from "./ai";
import { NotAuthenticatedError } from "./getServerUserSession";

/**
 * One place that turns a thrown error into the response an endpoint should
 * send, so every route reports auth, AI credit and rate-limit failures the
 * same way. Backend only.
 */
export function endpointError(error: unknown): Response {
  if (error instanceof NotAuthenticatedError) {
    return json({ error: "Please sign in again." }, 401);
  }
  if (error instanceof AiOutOfCreditsError) {
    return json(
      {
        error: "Word help is unavailable right now.",
        code: "OUT_OF_CREDITS",
      },
      503,
    );
  }
  if (error instanceof AiRateLimitError) {
    return json({ error: "Too many requests. Please wait a moment." }, 429);
  }
  const message =
    error instanceof Error ? error.message : "Something went wrong.";
  console.error("endpoint error:", message);
  return json({ error: message }, 400);
}

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(superjson.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
