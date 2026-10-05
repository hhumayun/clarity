/**
 * When an untitled note gets a title from the AI. No React Native imports,
 * so the rules can be tested on their own.
 */

/** An idea is offered once the note has this much text (and the writer pauses). */
export const TITLE_IDEA_MIN_CHARS = 40;

type TitleState = {
  /** The title as it stands. */
  title: string;
  /** The writer typed in the title field this visit, even if they cleared it. */
  titleTouched: boolean;
  /** They waved the idea away this visit. */
  dismissed: boolean;
  /** AI suggestions are switched on in the editor. */
  aiOn: boolean;
};

function untitledAndOpenToIdeas(state: TitleState): boolean {
  return state.aiOn && !state.dismissed && !state.titleTouched && state.title.trim() === "";
}

/** Whether to ask for a title idea while the writer is in the note. */
export function wantsTitleIdea(state: TitleState & { content: string }): boolean {
  return untitledAndOpenToIdeas(state) && state.content.trim().length >= TITLE_IDEA_MIN_CHARS;
}

/**
 * Whether leaving should give the note a title: it is untitled, the writer
 * never touched the title, and they changed the text this visit. Opening a
 * note and closing it again never edits it.
 */
export function wantsTitleOnLeave(
  state: TitleState & { content: string; contentAtOpen: string | null },
): boolean {
  return (
    untitledAndOpenToIdeas(state) &&
    state.content.trim() !== "" &&
    state.contentAtOpen !== null &&
    state.content !== state.contentAtOpen
  );
}
