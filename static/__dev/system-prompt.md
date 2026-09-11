Import my "Clarity Notes" project from Replit into Floot, doing a full port adapted to Floot conventions.

Clarity Notes is a calm, low-cognitive-load note-taking app for people with mild cognitive impairment or word-finding difficulty, with adaptive AI word suggestions above the keyboard. The original is an Expo/React Native app with an Express API, Clerk auth, Postgres + Drizzle, and an OpenAI-backed suggestion engine.

Port everything: auth (email/password + Google), 3-step onboarding, notes list (search, Current/Archived tabs, archive/restore/delete with confirmations), the editor (large type, autosave, tappable suggestion bubbles that insert at the cursor with smart spacing/capitalization, undo chip, per-bubble dismiss, hideable bar), the adaptive suggestion engine (entity-based related-note retrieval, accepted/dismissed history personalization, non-blocking with on-device fallbacks), settings (extra-large-text mode, logout) and privacy (personalization toggle, clear suggestion history, export notes as JSON, delete account).

Fresh start: new empty database, Floot's own auth, and Floot AI instead of the Replit OpenAI proxy.

Design: warm off-white surfaces with a soft teal accent, light and dark, generous type, 14px radius. Calm, plain, reassuring language in all copy. It is an assistive tool, NOT a medical device — keep the disclaimer.