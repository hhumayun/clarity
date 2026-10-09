import { z } from "zod";
import superjson from "superjson";
import { apiFetch } from "../../helpers/apiFetch";
import { AttachmentContentTypeArrayValues } from "../../helpers/schema";
import { attachmentIdSchema, type AttachmentRecord } from "../../helpers/attachmentLimits";

export const schema = z.object({
  id: attachmentIdSchema,
  contentType: z.enum(AttachmentContentTypeArrayValues),
  bytes: z.number().int().positive(),
  width: z.number().int().min(1).max(20000).optional(),
  height: z.number().int().min(1).max(20000).optional(),
});

export type InputType = z.infer<typeof schema>;

export type OutputType =
  | { status: "ready"; attachment: AttachmentRecord }
  | {
      status: "pending";
      upload: { url: string; method: "PUT"; headers: Record<string, string>; expiresAt: Date };
    };

export const postAttachmentStart = async (body: InputType, init?: RequestInit): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await apiFetch(`/_api/attachments/start`, {
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
