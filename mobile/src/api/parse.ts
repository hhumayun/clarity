import superjson from "superjson";

export async function parseResponse<T>(result: Response): Promise<T> {
  const text = await result.text();
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string; code?: string }>(text);
    const error = new Error(errorObject.error) as Error & { code?: string };
    error.code = errorObject.code;
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
