import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { dayChoices, today, type Day } from "../../src/lib/dates";
import { useTask } from "../../src/store/hooks";
import { useStore } from "../../src/store/store";
import { tick } from "../../src/ui/haptics";
import { InlineCalendar } from "../../src/ui/Calendar";
import { ChoiceChips, SheetFrame } from "../../src/ui/Sheet";

/** A task's day, or (with ?mode=day) the day Today shows. Choices save at once and the sheet closes. */
export default function DateSheet() {
  const { task: taskId, mode } = useLocalSearchParams<{ task?: string; mode?: string }>();
  const router = useRouter();
  const task = useTask(taskId);
  const moveTask = useStore((state) => state.moveTask);
  const viewDay = useStore((state) => state.viewDay);
  const setViewDay = useStore((state) => state.setViewDay);

  if (mode === "day") {
    const go = (day: Day) => {
      tick();
      setViewDay(day);
      router.back();
    };
    return (
      <SheetFrame title="Go to a day">
        <ChoiceChips choices={[{ label: "Today", value: today() }]} selected={(day) => day === viewDay} onChoose={go} />
        <InlineCalendar value={viewDay} onChange={go} />
      </SheetFrame>
    );
  }

  if (!task) return <SheetFrame title="Date" description="This task could not be found." />;
  const choose = (day: Day | null) => {
    tick();
    moveTask(task.id, day);
    router.back();
  };
  return (
    <SheetFrame title="Date" description={task.title}>
      <ChoiceChips choices={dayChoices().map((choice) => ({ label: choice.label, value: choice.day }))} selected={(day) => day === task.day} onChoose={choose} />
      <InlineCalendar value={task.day} onChange={choose} />
    </SheetFrame>
  );
}
