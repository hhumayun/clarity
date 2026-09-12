# Clarity Notes

A calm, low-cognitive-load note-taking app for people with mild cognitive impairment or word-finding difficulty, with adaptive AI word suggestions above the keyboard.

It is an assistive tool, **not** a medical device.

## Stack

- **Frontend:** React 19 + Vite + react-router + TanStack Query
- **Backend:** Node + Hono (`server.ts`), API endpoints in `endpoints/`
- **Auth:** [Clerk](https://clerk.com) (email/password + social providers)
- **Database:** [Neon](https://neon.tech) Postgres, queried with Kysely
- **AI:** Google Gemini (`@google/genai`) for suggestions, task extraction and entity indexing
- **Hosting:** [Railway](https://railway.com) (see `railway.json`)

## Setup

### 1. Neon (database)

1. Create a project at [neon.tech](https://neon.tech) and copy the **pooled connection string**.
2. Create the schema — either paste `migrations/001_init.sql` into the Neon SQL Editor, or run:
   ```bash
   psql "YOUR_NEON_CONNECTION_STRING" -f migrations/001_init.sql
   ```

### 2. Clerk (auth)

1. Create an application at [dashboard.clerk.com](https://dashboard.clerk.com) (enable Email + password; Google optional).
2. From **API keys**, copy the **Publishable key** (`pk_...`) and **Secret key** (`sk_...`).
3. When you deploy to Railway, add your Railway domain to Clerk's allowed domains (or create a Clerk production instance).

### 3. Gemini (AI suggestions)

Get an API key from [Google AI Studio](https://aistudio.google.com/apikey).

### 4. Environment variables

```bash
cp .env.example .env
```

Fill in `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`,
`VITE_CLERK_PUBLISHABLE_KEY` and `GEMINI_API_KEY`.

## Run locally

```bash
npm install
npm run build
npm start          # serves the app + API on http://localhost:3333
```

For development with hot reload:

```bash
npm run dev        # Vite dev server on :5173 (proxies /_api to :3333) + API watcher
```

## Deploy to Railway

1. Push this folder to a GitHub repo.
2. In Railway: **New Project → Deploy from GitHub repo**.
3. Add the environment variables from `.env.example` in the Railway **Variables** tab.
   (`VITE_CLERK_PUBLISHABLE_KEY` is needed at **build** time; `PORT` is set by Railway automatically.)
4. Railway builds with `npm install && npm run build` and starts with `npm start` (see `railway.json`).
5. Add the Railway HTTPS domain to Clerk's allowed origins. On a phone, open that URL in Chrome (Android) or Safari (iOS) and install from Settings, or use the browser's Add to Home Screen.

## Install on a phone

Clarity Notes is a Progressive Web App. After it is served over HTTPS (Railway) or localhost:

- **Android / Chrome:** Settings → Install app, or the browser install banner.
- **iOS / Safari:** Share → Add to Home Screen.

The installed app opens on its own, without the browser chrome. Notes still need a network connection.

## How auth works

- The frontend signs in with Clerk (`pages/login.tsx`, `pages/register.tsx`).
- Every `/_api` request carries the Clerk session token (`helpers/apiFetch.tsx`).
- The server verifies it with `@clerk/backend` and maps the Clerk user to an
  internal `users` row via `clerk_id`, creating it on first sign-in
  (`helpers/getServerUserSession.tsx`).
