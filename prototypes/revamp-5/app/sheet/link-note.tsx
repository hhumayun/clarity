import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { useTask } from "../../src/data/hooks";
import { noteGroup, noteTime } from "../../src/store/selectors";
import { useSage } from "../../src/data/sage";
import { tick } from "../../src/ui/haptics";
import { SearchField } from "../../src/ui/SearchField";
import { SheetFrame, SheetList, SheetRow } from "../../src/ui/Sheet";
import { Txt } from "../../src/ui/Txt";

/** Keep notes with a task: tap to link, tap again to unlink. */
export default function LinkNoteSheet() {
  const { task: taskId } = useLocalSearchParams<{ task: string }>();
  const router = useRouter();
  const task = useTask(taskId);
  const notes = useSage((state) => state.notes);
  const linkNote = useSage((state) => state.linkNote);
  const unlinkNote = useSage((state) => state.unlinkNote);
  const [query, setQuery] = useState("");
  if (!task) return <SheetFrame title="Link a note" description="This task could not be found." />;
  const q = query.trim().toLowerCase();
  const shown = notes.filter((note) => !q || `${note.title} ${note.excerpt}`.toLowerCase().includes(q)).slice(0, 40);

  return (
    <SheetFrame title="Link a note" description={task.title} scroll action={{ label: "Done", onPress: () => router.back() }}>
      <SearchField value={query} onChangeText={setQuery} placeholder="Search your notes" />
      {shown.length === 0 ? (
        <Txt variant="subhead" tone="ink3">
          {notes.length ? "No notes match." : "You have no notes yet."}
        </Txt>
      ) : (
        <SheetList>
          {shown.map((note) => {
            const linked = task.noteIds.includes(note.id);
            return (
              <SheetRow
                key={note.id}
                label={note.title}
                detail={`${noteGroup(note.day)} · ${noteTime(note.time)}${note.source === "focus" ? " · Parked during focus" : ""}`}
                role="checkbox"
                selected={linked}
                onPress={() => {
                  tick();
                  if (linked) unlinkNote(task.id, note.id);
                  else linkNote(task.id, note.id);
                }}
              />
            );
          })}
        </SheetList>
      )}
    </SheetFrame>
  );
}
