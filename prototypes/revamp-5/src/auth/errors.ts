type ClerkIssue = { code?: string; message?: string; longMessage?: string };

function firstIssue(error: unknown): ClerkIssue | undefined {
  const issues = (error as { errors?: ClerkIssue[] } | null)?.errors;
  return Array.isArray(issues) ? issues[0] : undefined;
}

/** The code of the first problem Clerk reported ("form_password_incorrect"), if it was Clerk. */
export function clerkCode(error: unknown): string | undefined {
  return firstIssue(error)?.code;
}

const MESSAGES: Record<string, string> = {
  form_password_incorrect: "That password doesn't match. Try again, or reset it.",
  form_password_pwned: "That password has turned up in a data breach elsewhere. Please choose another.",
  form_password_length_too_short: "Use at least 8 characters.",
  form_password_not_strong_enough: "Choose a longer or less common password.",
  form_code_incorrect: "That code didn't match. Check the email and try again.",
  verification_expired: "That code has expired. Ask for a new one.",
  verification_failed: "That code didn't work. Ask for a new one.",
  form_identifier_exists: "There's already an account with this email.",
  form_param_format_invalid: "That doesn't look like an email address.",
  too_many_requests: "Too many tries. Wait a minute, then try again.",
  user_locked: "This account is locked for a while after too many tries. Try again later.",
};

/** What went wrong, in a sentence for the person, never a code. */
export function authMessage(error: unknown, fallback: string): string {
  const issue = firstIssue(error);
  if (issue?.code && MESSAGES[issue.code]) return MESSAGES[issue.code];
  if (issue) return issue.longMessage ?? issue.message ?? fallback;
  if (error instanceof TypeError && /network|fetch/i.test(error.message)) return "No connection. Check your internet and try again.";
  return fallback;
}

/** A rough check, enough to light the button: something@something.something. */
export function looksLikeEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text.trim());
}
