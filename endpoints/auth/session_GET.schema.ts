import { z } from "zod";
import superjson from "superjson";
import { User } from "../../helpers/User";
import { apiFetch } from "../../helpers/apiFetch";

// no schema, just a simple GET request
export const schema = z.object({});

export type OutputType =
  | {
      user: User;
    }
  | {
      error: string;
    };

export const getSession = async (
  body: z.infer<typeof schema> = {},
  init?: RequestInit
): Promise<OutputType> => {
  const result = await apiFetch(`/_api/auth/session`, {
    method: "GET",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  return superjson.parse<OutputType>(await result.text());
};
