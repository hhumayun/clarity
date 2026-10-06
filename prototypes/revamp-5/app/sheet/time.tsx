import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { addDays, today } from "../../src/lib/dates";
import { useTask } from "../../src/data/hooks";
import { useSage } from "../../src/data/sage";
import { TimeSpinner } from "../../src/ui/Calendar";
import { SheetButtons, SheetFrame } from "../../src/ui/Sheet";

/** A task's time of day. A task with no day goes on today, or tomorrow once that time has passed. */
export default function TimeSheet() {
  const { task: taskId } = useLocalSearchParams<{ task: string }>();
  const router = useRouter();
  const task = useTask(taskId);
  const updateTask = useSage((state) => state.updateTask);
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const [minutes, setMinutes] = useState(() => {
    if (task?.time != null) return task.time;
    if (task?.day && task.day > today()) return 9 * 60;
    return Math.min(23 * 60, (Math.floor(nowMinutes / 60) + 1) * 60);
  });
  if (!task) return <SheetFrame title="Time" description="This task could not be found." />;

  const set = () => {
    const day = task.day ?? (minutes > nowMinutes ? today() : addDays(today(), 1));
    updateTask(task.id, { day, time: minutes });
    router.back();
  };
  const clear = () => {
    const remind = task.remind === null ? null : task.remind < 1_440 ? 0 : Math.round(task.remind / 1_440) * 1_440;
    updateTask(task.id, { time: null, remind });
    router.back();
  };
  return (
    <SheetFrame title="Time" description={task.day ? task.title : "With no day yet, it goes on today, or tomorrow if the time has passed."}>
      <TimeSpinner value={minutes} onChange={setMinutes} />
      <SheetButtons primary={{ label: "Set time", onPress: set }} secondary={task.time !== null ? { label: "No time", onPress: clear } : undefined} />
    </SheetFrame>
  );
}
