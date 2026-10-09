import { z } from "zod";
import superjson from "superjson";
import { apiFetch } from "../../helpers/apiFetch";

// Ids aren't checked against the photo-id rule here: one malformed id (a
// token broken by hand in the web app) must not blank the others in the batch.
export const schema = z.object({
  ids: z.array(z.string().max(100)).min(1).max(100),
});

export type InputType = z.infer<typeof schema>;

export type PhotoView = {
  url: string;
  expiresAt: Date;
  contentType: string;
  width: number | null;
  height: number | null;
};

export type OutputType = {
  /**
   * Every asked id is a key. null means not uploaded, still pending, deleted,
   * malformed, or not this account's: the same answer in each case.
   */
  photos: Record<string, PhotoView | null>;
};

export const postAttachmentView = async (body: InputType, init?: RequestInit): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await apiFetch(`/_api/attachments/view`, {
    method: "POST",
    body: superjson.stringify(validatedInput),
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};
