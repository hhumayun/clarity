import * as Crypto from "expo-crypto";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { photoStore } from "./photoStore";

/**
 * Photos in notes. A photo is taken or chosen, shrunk, and kept on the phone
 * under a new id (photoStore); the note only names it, as
 * `![](attachment:<id>)` (editor/extensions.ts), and the editor page asks for
 * it by id to show it (`photoSource`). Until photos are kept on the server
 * too, a photo is only on the phone it was added on, so the note page offers
 * them in the samples only (docs/editor-plan.md, "Photos").
 */

// Kept no larger than this on its longer side, as a JPEG of this quality:
// sharp on a phone's screen, and a few hundred KB.
const LONGER_SIDE = 2048;
const QUALITY = 0.7;

export type PhotoFrom = "camera" | "library";
export type AddedPhoto = { id: string; width: number; height: number };

/** A photo's id names a kept photo and nothing else (never a path). */
const isPhotoId = (id: string) => /^[A-Za-z0-9-]{8,64}$/.test(id);

// The photos shown last, ready to show again without reading them.
const recent = new Map<string, string>();
const RECENT_MAX = 8;
function remember(id: string, src: string) {
  recent.delete(id);
  recent.set(id, src);
  if (recent.size > RECENT_MAX) recent.delete(recent.keys().next().value as string);
}

/**
 * A photo taken with the camera or chosen from the library, kept on the
 * phone: made a JPEG (whatever it was taken as, an iPhone's HEIC say) and
 * shrunk if it's larger. Null if none was taken or chosen; "denied" when the
 * camera isn't allowed.
 */
export async function addPhoto(from: PhotoFrom): Promise<AddedPhoto | "denied" | null> {
  if (from === "camera" && !(await ImagePicker.requestCameraPermissionsAsync()).granted) return "denied";
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 1 };
  const picked = from === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  const asset = picked.canceled ? null : picked.assets[0];
  if (!asset) return null;
  let image = await ImageManipulator.manipulate(asset.uri).renderAsync();
  const longer = Math.max(image.width, image.height);
  if (longer > LONGER_SIDE) {
    const scale = LONGER_SIDE / longer;
    image = await ImageManipulator.manipulate(image)
      .resize({ width: Math.round(image.width * scale), height: Math.round(image.height * scale) })
      .renderAsync();
  }
  const saved = await image.saveAsync({ compress: QUALITY, format: SaveFormat.JPEG, base64: photoStore.wantsBase64 });
  const id = Crypto.randomUUID();
  await photoStore.keep(id, saved);
  if (saved.base64) remember(id, `data:image/jpeg;base64,${saved.base64}`);
  return { id, width: saved.width, height: saved.height };
}

/** Where the editor can show a photo from (a `data:` address), or null when it isn't on this phone. */
export async function photoSource(id: string): Promise<string | null> {
  if (!isPhotoId(id)) return null;
  const known = recent.get(id);
  if (known) {
    remember(id, known);
    return known;
  }
  const src = await photoStore.read(id);
  if (src) remember(id, src);
  return src;
}
