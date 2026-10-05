import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { useNote, useTask } from "../../src/store/hooks";
import { useStore } from "../../src/store/store";
import { tick } from "../../src/ui/haptics";
import { SheetButtons, SheetFrame, SheetList, SheetRow, TextField } from "../../src/ui/Sheet";

/** Which area a task, a note, or a note not yet saved (?draft=1) belongs to; a new one can be made here. */
export default function AreaSheet() {
  const { task: taskId, note: noteId, draft } = useLocalSearchParams<{ task?: string; note?: string; draft?: string }>();
  const router = useRouter();
  const task = useTask(taskId);
  const note = useNote(noteId);
  const areas = useStore((state) => state.areas);
  const updateTask = useStore((state) => state.updateTask);
  const setNoteArea = useStore((state) => state.setNoteArea);
  const addArea = useStore((state) => state.addArea);
  const draftArea = useStore((state) => state.draftArea);
  const setDraftArea = useStore((state) => state.setDraftArea);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const isDraft = draft === "1";
  const current = task?.area ?? note?.area ?? (isDraft ? draftArea : null);

  const choose = (area: string | null) => {
    tick();
    if (task && area) updateTask(task.id, { area });
    if (note) setNoteArea(note.id, area);
    if (isDraft) setDraftArea(area);
    router.back();
  };

  if (adding) {
    return (
      <SheetFrame title="New area">
        <TextField
          autoFocus
          value={name}
          onChangeText={setName}
          placeholder="Health"
          returnKeyType="done"
          onSubmitEditing={() => name.trim() && choose(addArea(name))}
          accessibilityLabel="Area name"
        />
        <SheetButtons primary={{ label: "Add area", icon: "plus", onPress: () => choose(addArea(name)), disabled: !name.trim() }} secondary={{ label: "Back", onPress: () => setAdding(false) }} />
      </SheetFrame>
    );
  }

  return (
    <SheetFrame title="Area" description={task?.title} scroll>
      <SheetList>
        {areas.map((area) => (
          <SheetRow key={area.name} label={area.name} role="radio" selected={area.name === current} onPress={() => choose(area.name)} />
        ))}
        {(note || isDraft) && current ? <SheetRow key="none" icon="close" label="No area" onPress={() => choose(null)} /> : null}
        <SheetRow key="new" icon="plus" label="New area" onPress={() => setAdding(true)} />
      </SheetList>
    </SheetFrame>
  );
}
