import superjson from "superjson";
import { db } from "../../helpers/db";
import { selectTaskRecords } from "../../helpers/taskRecords";
import { requireUser } from "../../helpers/requireUser";
import { endpointError } from "../../helpers/endpointError";
import { NOTE_RECORD_COLUMNS, readableDoc } from "../../helpers/NoteRecord";
import { attachProjectIds } from "../../helpers/noteProjects";
import { bucket, EXPORT_LINK_SECONDS, presignView, s3Call } from "../../helpers/bucket";
import type { AttachmentContentType } from "../../helpers/schema";
import type { ExportedPhoto, OutputType } from "./export_GET.schema";

const EXTENSION: Record<AttachmentContentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function handle(request: Request) {
  try {
    const user = await requireUser(request);

    const [noteRows, entities, projects, tasks, focusSessions, photoRows, photoLinks] = await Promise.all([
      db
        .selectFrom("notes")
        .select([...NOTE_RECORD_COLUMNS])
        .where("userId", "=", user.id)
        .orderBy("updatedAt", "desc")
        .execute(),
      db
        .selectFrom("noteEntities")
        .select(["noteId", "type", "name", "aliases"])
        .where("userId", "=", user.id)
        .execute(),
      db
        .selectFrom("projects")
        .select(["id", "name", "createdAt", "updatedAt"])
        .where("userId", "=", user.id)
        .orderBy("updatedAt", "desc")
        .execute(),
      selectTaskRecords(db, user.id)
        .orderBy("tasks.updatedAt", "desc")
        .execute(),
      db
        .selectFrom("focusSessions")
        .select([
          "id", "taskId", "plannedMinutes", "focusedSeconds", "firstStep",
          "outcome", "leftOff", "startedAt", "endedAt",
        ])
        .where("userId", "=", user.id)
        .orderBy("endedAt", "desc")
        .execute(),
      // Photos still in a note: ready, and not orphaned. The key never
      // leaves the server; it only signs the download link.
      db
        .selectFrom("attachments")
        .select(["id", "contentType", "bytes", "width", "height", "createdAt", "storageKey"])
        .where("userId", "=", user.id)
        .where("status", "=", "ready")
        .where("orphanedSince", "is", null)
        .orderBy("createdAt", "desc")
        .execute(),
      db
        .selectFrom("noteAttachments")
        .select(["noteId", "attachmentId"])
        .where("userId", "=", user.id)
        .execute(),
    ]);

    const notes = await attachProjectIds(db, noteRows.map(readableDoc), user.id);

    const noteIdsByPhoto = new Map<string, string[]>();
    for (const link of photoLinks) {
      const list = noteIdsByPhoto.get(link.attachmentId) ?? [];
      list.push(link.noteId);
      noteIdsByPhoto.set(link.attachmentId, list);
    }
    // Links last one hour: the file goes through the share sheet, and a link
    // in it can't be revoked. Signing is local work.
    const b = bucket();
    const photos: ExportedPhoto[] = [];
    for (const row of photoRows) {
      let url: string | null = null;
      if (b) {
        const name = `${row.id}.${EXTENSION[row.contentType] ?? "jpg"}`;
        url = await s3Call("sign export link", () => presignView(b, row.storageKey, EXPORT_LINK_SECONDS, name))
          .then((link) => link.url)
          .catch(() => null);
      }
      photos.push({
        id: row.id,
        contentType: row.contentType,
        bytes: row.bytes,
        width: row.width,
        height: row.height,
        createdAt: row.createdAt,
        noteIds: noteIdsByPhoto.get(row.id) ?? [],
        url,
      });
    }

    return new Response(
      superjson.stringify({
        exportedAt: new Date(),
        notes,
        entities,
        projects,
        tasks,
        focusSessions,
        photoLinksExpireAt: b ? new Date(Date.now() + EXPORT_LINK_SECONDS * 1000) : null,
        photoLinksNote:
          "Each photo's url downloads it until photoLinksExpireAt (one hour after the export). Export again for new links.",
        photos,
      } satisfies OutputType),
    );
  } catch (error) {
    return endpointError(error);
  }
}