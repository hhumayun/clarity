import superjson from "superjson";

/** A request the server answered with an error, carrying its HTTP status. */
export type ApiError = Error & { code?: string; status: number };

export async function parseResponse<T>(result: Response): Promise<T> {
  const text = await result.text();
  if (!result.ok) {
    // Usually our own JSON; a proxy in front can answer with a page instead.
    let message = `The request failed (${result.status}).`;
    let code: string | undefined;
    try {
      const errorObject = superjson.parse<{ error: string; code?: string }>(text);
      if (errorObject?.error) message = errorObject.error;
      code = errorObject?.code;
    } catch {
      // Not JSON: keep the generic message.
    }
    const error = new Error(message) as ApiError;
    error.code = code;
    error.status = result.status;
    throw error;
  }
  return superjson.parse<T>(text);
}

export function jsonHeaders(init?: RequestInit): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(init?.headers ?? {}),
  };
}
