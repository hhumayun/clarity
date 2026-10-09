import { z } from "zod";
import superjson from "superjson";
import { apiFetch } from "../../helpers/apiFetch";
import { attachmentIdSchema } from "../../helpers/attachmentLimits";

export const schema = z.object({
  id: attachmentIdSchema,
});

export type InputType = z.infer<typeof schema>;

export type OutputType = {
  /** Also when there was nothing to delete. */
  deleted: true;
};

export const postAttachmentDelete = async (body: InputType, init?: RequestInit): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await apiFetch(`/_api/attachments/delete`, {
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
