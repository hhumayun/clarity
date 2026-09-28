import { parseExtractedTasks } from "./parseExtractedTasks";
import { taskFingerprint } from "./taskFingerprint";

describe("task extraction helpers", () => {
  it("normalizes, validates, and deduplicates model tasks", () => {
    // Wednesday 23 September 2026, at the writer's noon.
    const today = new Date(2026, 8, 23, 12);
    const tasks = parseExtractedTasks({
      tasks: [
        { text: "  Call   Sam  ", projectName: " Family ", when: "on Friday" },
        { text: "call sam", projectName: "Other", when: "tomorrow" },
        { text: "Book appointment", projectName: "", when: null },
        { text: "Renew passport", projectName: "Admin", when: "in 6 months" },
        { text: "Tidy the shed", projectName: "Home", when: "someday" },
      ],
    }, today);
    expect(tasks).toEqual([
      { text: "Call Sam", projectName: "Family", completeBy: "2026-09-25" },
      { text: "Book appointment", projectName: "General", completeBy: null },
      { text: "Renew passport", projectName: "Admin", completeBy: "2027-03-23" },
      { text: "Tidy the shed", projectName: "Home", completeBy: null },
    ]);
  });

  it("keeps the extraction fingerprint stable after spacing and case changes", () => {
    expect(taskFingerprint("00000000-0000-0000-0000-000000000001", "Call Sam"))
      .toBe(taskFingerprint("00000000-0000-0000-0000-000000000001", " call   sam "));
  });
});