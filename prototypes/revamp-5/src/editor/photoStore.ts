import { Directory, File, Paths, UploadType } from "expo-file-system";
import { downloadAsync, FileSystemUploadType, uploadAsync } from "expo-file-system/legacy";

/**
 * Photos added to notes, kept on the phone: a JPEG each in the app's
 * documents (which the system never clears), named by the photo's id. The
 * web build keeps them in the browser instead (photoStore.web.ts). Account
 * notes' photos also go up to the server (photoUpload.ts) and come down
 * from it on a phone that hasn't got them (`save`).
 */
const folder = () => new Directory(Paths.document, "photos");
const fileOf = (id: string) => new File(folder(), `${id}.jpg`);

// Bumped by clearAll (signing out): a download started before it is thrown away.
let generation = 0;

// Whether this build lacks the newer native upload and download (Expo Go may;
// docs/photos-server.md 9.5): then the older API does the same work.
let useLegacy = false;
const isMissingNative = (error: unknown) =>
  error instanceof TypeError || /not a function|is undefined|not available|cannot find native|unimplemented/i.test(String((error as Error)?.message ?? error));

export const photoStore = {
  /** The web's store keeps a photo's data itself, so it wants it as the photo is saved. */
  wantsBase64: false,
  /** Keeps a shrunk photo (the file the manipulator saved) under its id. */
  async keep(id: string, saved: { uri: string; base64?: string }): Promise<void> {
    folder().create({ intermediates: true, idempotent: true });
    await new File(saved.uri).move(fileOf(id));
  },
  /** The photo as a `data:` address the editor can show, or null when it isn't on this phone. */
  async read(id: string): Promise<string | null> {
    const file = fileOf(id);
    if (!file.exists) return null;
    return `data:image/jpeg;base64,${await file.base64()}`;
  },
  /** Whether a photo is kept here. */
  async has(id: string): Promise<boolean> {
    return fileOf(id).exists;
  },
  /**
   * The kept photo, ready to upload: its size, and a PUT of it to a signed
   * link that gives back the HTTP status (any status: the caller decides).
   * Null when it isn't on this phone.
   */
  async forUpload(id: string): Promise<{ bytes: number; put(url: string, headers: Record<string, string>): Promise<number> } | null> {
    const file = fileOf(id);
    const bytes = file.exists ? file.size : null;
    if (!bytes) return null;
    return {
      bytes,
      put: async (url, headers) => {
        if (!useLegacy) {
          try {
            // In the foreground: a background session's answer is lost if the app is closed, and the outbox tries again anyway.
            const result = await file.upload(url, { httpMethod: "PUT", uploadType: UploadType.BINARY_CONTENT, headers, sessionType: "foreground" });
            return result.status;
          } catch (error) {
            if (!isMissingNative(error)) throw error;
            useLegacy = true;
          }
        }
        const result = await uploadAsync(url, file.uri, { httpMethod: "PUT", uploadType: FileSystemUploadType.BINARY_CONTENT, headers });
        return result.status;
      },
    };
  },
  /** Downloads a photo from a signed link and keeps it under its id, unless clearAll ran meanwhile. */
  async save(id: string, url: string): Promise<void> {
    const started = generation;
    folder().create({ intermediates: true, idempotent: true });
    const part = new File(folder(), `${id}.part`);
    if (part.exists) part.delete();
    try {
      let fetched = false;
      if (!useLegacy) {
        try {
          // Rejects on any answer but a 2xx.
          await File.downloadFileAsync(url, part, { idempotent: true });
          fetched = true;
        } catch (error) {
          if (!isMissingNative(error)) throw error;
          useLegacy = true;
        }
      }
      if (!fetched) {
        const result = await downloadAsync(url, part.uri);
        if (result.status < 200 || result.status >= 300) throw Object.assign(new Error("download"), { status: result.status });
      }
      // Signed out meanwhile: nothing of theirs stays.
      if (started !== generation) return;
      const kept = fileOf(id);
      if (kept.exists) kept.delete();
      // (move points `part` at the kept file, so the clean-up below looks at the old name afresh.)
      await part.move(kept);
    } finally {
      // Android may leave a partial file behind a failed download.
      const leftover = new File(folder(), `${id}.part`);
      if (leftover.exists) leftover.delete();
    }
  },
  /** Forgets every kept photo (signing out), and bumps `generation`. */
  async clearAll(): Promise<void> {
    generation += 1;
    const dir = folder();
    if (dir.exists) dir.delete();
  },
  /** Bumped by clearAll. A download started before it is thrown away. */
  generation(): number {
    return generation;
  },
};
