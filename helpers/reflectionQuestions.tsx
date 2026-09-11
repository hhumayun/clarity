export const REFLECTION_QUESTIONS = [
  "What made that stand out to you?",
  "How did that feel?",
  "What do you want to remember about this?",
  "What else was part of that moment?",
];

export const DEFAULT_REFLECTION_QUESTION = REFLECTION_QUESTIONS[0];

/**
 * Deterministic per text length, so the question never flickers between
 * otherwise-identical responses while the writer pauses.
 */
export function reflectionQuestions(textBeforeCursor: string): string {
  return REFLECTION_QUESTIONS[
    textBeforeCursor.length % REFLECTION_QUESTIONS.length
  ];
}