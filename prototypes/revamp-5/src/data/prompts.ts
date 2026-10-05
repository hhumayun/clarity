import type { Phase } from "../theme/tokens";

/**
 * The day's questions, by the hour, and the words the Today card greets
 * with. "Another question" walks through a phase's list.
 */
export const greetings: Record<Phase, string> = {
  dawn: "Good morning",
  day: "Good afternoon",
  dusk: "Good evening",
  night: "Still up?",
};

export const questions: Record<Phase, string[]> = {
  dawn: ["What would make today feel well spent?", "What's the one thing that matters most today?", "How do you want to feel by tonight?"],
  day: ["What are you putting off, and what's the smallest first step?", "What's taking more of your attention than it deserves?", "What would make the rest of today easier?"],
  dusk: ["What went better than you expected today?", "What did today teach you?", "What are you glad you did today?"],
  night: ["What can you set down until tomorrow?", "What's still on your mind?", "What would make tomorrow morning easier?"],
};

/** The question a note's "Go deeper" offers, after reading it. The sample notes have their own; others get one of these. */
export const deeper: Record<string, string[]> = {
  "slow-morning": [
    "You keep coming back to the first hour. What would it take to protect it on busy days too?",
    "What made this morning feel different from a rushed one?",
  ],
  "q4-plan": ["Which of these would you still choose if you could only do one?", "What would saying no to urgent-looking work free you up for?"],
  "kitchen-shelves": ["What's the smallest step that gets the shelves up this week?"],
  "canal-run": ["What changed that made today's run feel easy?"],
  "call-mum": ["What does Mum need most from you right now: help, or company?"],
};
export const deeperFallback = ["What would you tell a friend who wrote this?", "What's the part of this you haven't said yet?", "What would change if this went well?"];
