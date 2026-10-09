import superjson from "superjson";
import { apiFetch } from "../../helpers/apiFetch";

export type OutputType = {
  /** False when the server has no bucket: photos are off and the Photo tool is hidden. */
  enabled: boolean;
  /** Bytes of this account's photos, pending and ready. */
  usedBytes: number;
  quotaBytes: number;
  maxPhotoBytes: number;
  /** Photos this account keeps, pending and ready. */
  photos: number;
  maxPhotos: number;
};

export const getAttachmentUsage = async (init?: RequestInit): Promise<OutputType> => {
  const result = await apiFetch("/_api/attachments/usage", { method: "GET", ...init });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};
