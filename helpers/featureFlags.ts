/**
 * Front-end switches only. The backend is untouched: every task and project
 * endpoint stays live, and nothing is removed from the database. These flags
 * decide what the app offers, not what the API can do.
 *
 * Set TASKS_ENABLED back to true to restore the Life Center page, its nav
 * link and the Tasks tab inside a note. Nothing else needs to change.
 */
export const TASKS_ENABLED = false;
