import { parseExtractedTasks } from "./parseExtractedTasks";
import { taskFingerprint } from "./taskFingerprint";

describe("task extraction helpers", () => {
  it("normalizes, validates, and deduplicates model tasks", () => {
    const tasks = parseExtractedTasks({
      tasks: [
        { text: "  Call   Sam  ", projectName: " Family ", completeBy: "2026-09-10" },
        { text: "call sam", projectName: "Other", completeBy: "not-a-date" },
        { text: "Book appointment", projectName: "", completeBy: null },
      ],
    });
    expect(tasks).toEqual([
      { text: "Call Sam", projectName: "Family", completeBy: "2026-09-10" },
      { text: "Book appointment", projectName: "General", completeBy: null },
    ]);
  });

  it("keeps the extraction fingerprint stable after spacing and case changes", () => {
    expect(taskFingerprint("00000000-0000-0000-0000-000000000001", "Call Sam"))
      .toBe(taskFingerprint("00000000-0000-0000-0000-000000000001", " call   sam "));
  });
});