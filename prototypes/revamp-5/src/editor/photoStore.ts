import { Directory, File, Paths } from "expo-file-system";

/**
 * Photos added to notes, kept on the phone: a JPEG each in the app's
 * documents (which the system never clears), named by the photo's id. The
 * web build keeps them in the browser instead (photoStore.web.ts).
 */
const folder = () => new Directory(Paths.document, "photos");
const fileOf = (id: string) => new File(folder(), `${id}.jpg`);

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
};
