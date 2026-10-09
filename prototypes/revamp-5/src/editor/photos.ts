import * as Crypto from "expo-crypto";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { postAttachmentsView } from "../core/api/attachments";
import { photoStore } from "./photoStore";

/**
 * Photos in notes. A photo is taken or chosen, shrunk, and kept on the phone
 * under a new id (photoStore); the note only names it, as
 * `![](attachment:<id>)` (editor/extensions.ts), and the editor page asks for
 * it by id to show it (`photoSource`). In the samples a photo stays on the
 * phone it was added on. In account notes it also goes up to the server
 * through the outbox (photoUpload.ts), and a phone that hasn't got it fetches
 * it from there (`fetchPhoto`) and keeps it (docs/editor-plan.md, "Photos";
 * docs/photos-server.md in the server's repo).
 */

// Kept no larger than this on its longer side, as a JPEG of this quality:
// sharp on a phone's screen, and a few hundred KB.
const LONGER_SIDE = 2048;
const QUALITY = 0.7;

export type PhotoFrom = "camera" | "library";
export type AddedPhoto = { id: string; width: number; height: number };

/** A photo's id names a kept photo and nothing else (never a path). */
export const isPhotoId = (id: string) => /^[A-Za-z0-9-]{8,64}$/.test(id);

const IN_TEXT = /attachment:([A-Za-z0-9-]{8,64})/g;

/**
 * The photos a note's Markdown names, by the server's own loose rule
 * (attachmentIdsInText): any `attachment:<id>`, even in a broken token.
 */
export function photoIdsIn(markdown: string): Set<string> {
  const ids = new Set<string>();
  for (const match of markdown.matchAll(IN_TEXT)) ids.add(match[1]);
  return ids;
}

// The photos shown last, ready to show again without reading them.
const recent = new Map<string, string>();
const RECENT_MAX = 8;
// Bumped by forgetPhotos (signing out): what was being fetched before is thrown away.
let generation = 0;
function remember(id: string, src: string, from = generation) {
  if (from !== generation) return;
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

// ---- From the server (account notes) -----------------------------------------

// Asked for and not answered yet: the same photo asked twice shares one answer.
const fetching = new Map<string, Promise<string | null>>();
// Asked within a moment of each other: one call to the server for them all.
const BATCH_MS = 25;
const BATCH_MAX = 100;
let batch: { id: string; resolve: (url: string | null) => void }[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;

function sendBatch() {
  batchTimer = null;
  const asked = batch;
  batch = [];
  for (let start = 0; start < asked.length; start += BATCH_MAX) {
    const part = asked.slice(start, start + BATCH_MAX);
    postAttachmentsView({ ids: part.map((item) => item.id) }).then(
      ({ photos }) => {
        for (const item of part) item.resolve(photos?.[item.id]?.url ?? null);
      },
      () => {
        for (const item of part) item.resolve(null);
      },
    );
  }
}

/** A short-lived link to a photo on the server, or null. */
function viewLink(id: string): Promise<string | null> {
  return new Promise((resolve) => {
    batch.push({ id, resolve });
    if (batch.length >= BATCH_MAX) {
      if (batchTimer) clearTimeout(batchTimer);
      sendBatch();
    } else if (!batchTimer) {
      batchTimer = setTimeout(sendBatch, BATCH_MS);
    }
  });
}

/**
 * A photo from the server, kept here once fetched: where the editor can show
 * it from, or null if the server hasn't got it (not uploaded yet, or never),
 * or there's no connection. Asked again later, it tries again.
 */
export function fetchPhoto(id: string): Promise<string | null> {
  if (!isPhotoId(id)) return Promise.resolve(null);
  const already = fetching.get(id);
  if (already) return already;
  const from = generation;
  const storeFrom = photoStore.generation();
  let work: Promise<string | null> | undefined = undefined;
  work = (async () => {
    try {
      const url = await viewLink(id);
      if (!url || from !== generation) return null;
      await photoStore.save(id, url);
      if (from !== generation || storeFrom !== photoStore.generation()) return null;
      const src = await photoStore.read(id);
      if (!src || from !== generation) return null;
      remember(id, src, from);
      return src;
    } catch {
      return null;
    } finally {
      if (fetching.get(id) === work) fetching.delete(id);
    }
  })();
  fetching.set(id, work);
  return work;
}

/** Signing out: nothing shown before is shown again, and nothing being fetched is kept. */
export function forgetPhotos() {
  generation += 1;
  recent.clear();
  fetching.clear();
}
