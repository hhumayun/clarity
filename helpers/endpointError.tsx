import superjson from "superjson";
import { AiOutOfCreditsError, AiRateLimitError } from "./ai";
import { NotAuthenticatedError } from "./getServerUserSession";

/**
 * A photo endpoint's answer other than success: an HTTP status and a
 * `code` clients act on (Sage's parseResponse reads it). The message is
 * shown to the writer, so it never carries bucket details.
 */
export class AttachmentError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "AttachmentError";
  }
}

/** Every photo answer, by code: its status and message (docs/photos-server.md, 5.1). */
export const ATTACHMENT_ERRORS = {
  PHOTOS_UNAVAILABLE: [503, "Photos can't be kept just now."],
  RATE_LIMITED: [429, "Too many photos at once. Please wait a moment."],
  TOO_MANY_PENDING: [429, "Some photos are still uploading. Please wait a moment."],
  TOO_LARGE: [413, "That photo is larger than 10 MB."],
  QUOTA_FULL: [413, "Your photos have used all 1 GB of space."],
  PHOTO_LIMIT: [413, "This account already keeps 10,000 photos."],
  NOT_FOUND: [404, "That photo could not be found."],
  NOT_UPLOADED: [409, "That photo hasn't arrived yet."],
  UPLOAD_CHANGED: [409, "That photo changed while it was uploading."],
  UPLOAD_MISMATCH: [422, "That photo didn't arrive whole."],
  IN_USE: [409, "A note still has that photo."],
  TOO_MANY_PHOTOS: [422, "A note can hold up to 200 photos."],
} as const satisfies Record<string, readonly [number, string]>;

export type AttachmentErrorCode = keyof typeof ATTACHMENT_ERRORS;

/** The AttachmentError for a code, with its status and message from the table. */
export function attachmentError(code: AttachmentErrorCode): AttachmentError {
  const [status, message] = ATTACHMENT_ERRORS[code];
  return new AttachmentError(status, code, message);
}

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
  if (error instanceof AttachmentError) {
    return json({ error: error.message, code: error.code }, error.status);
  }
  // The database lacks a table or column the code reads (deployed before
  // its migration): the server's fault, not the request's. 503, so clients
  // keep the change and try again instead of dropping it.
  const sqlState = (error as { code?: unknown } | null)?.code;
  if (sqlState === "42P01" || sqlState === "42703") {
    console.error("endpoint error: database schema", sqlState);
    return json({ error: "Something went wrong on our side. Please try again." }, 503);
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
