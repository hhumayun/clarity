import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { useNote } from "../../src/store/hooks";
import { byPlan, whenLabel } from "../../src/store/selectors";
import { useStore } from "../../src/store/store";
import { useAcknowledge } from "../../src/ui/Acknowledgement";
import { tick } from "../../src/ui/haptics";
import { SearchField } from "../../src/ui/SearchField";
import { SheetFrame, SheetList, SheetRow } from "../../src/ui/Sheet";
import { Txt } from "../../src/ui/Txt";

/** Keep one of your open tasks with this note. */
export default function LinkTaskSheet() {
  const { note: noteId } = useLocalSearchParams<{ note: string }>();
  const router = useRouter();
  const acknowledge = useAcknowledge();
  const note = useNote(noteId);
  const tasks = useStore((state) => state.tasks);
  const linkNote = useStore((state) => state.linkNote);
  const [query, setQuery] = useState("");
  if (!note) return <SheetFrame title="Link a task" description="This note could not be found." />;
  const q = query.trim().toLowerCase();
  const candidates = tasks.filter((task) => !task.done && !task.noteIds.includes(note.id)).sort(byPlan);
  const shown = candidates.filter((task) => !q || task.title.toLowerCase().includes(q)).slice(0, 60);

  return (
    <SheetFrame title="Link a task" scroll>
      <SearchField value={query} onChangeText={setQuery} placeholder="Search your tasks" />
      {shown.length === 0 ? (
        <Txt variant="subhead" tone="ink3">
          {candidates.length ? "No open tasks match." : "No other open tasks to link."}
        </Txt>
      ) : (
        <SheetList>
          {shown.map((task) => (
            <SheetRow
              key={task.id}
              label={task.title}
              detail={`${task.area} · ${whenLabel(task)}${task.noteIds.length ? " · Also in other notes" : ""}`}
              onPress={() => {
                tick();
                linkNote(task.id, note.id);
                router.back();
                acknowledge("Linked to this note", "link");
              }}
            />
          ))}
        </SheetList>
      )}
    </SheetFrame>
  );
}
