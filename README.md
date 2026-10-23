# Plateside

Clients log meals with a photo. AI names the foods and estimates portions, the client corrects anything wrong, and their coach sees the whole day on one screen, replies to meals, and gets an AI weekly summary per client.

**Who it is for:** online nutrition coaches and their clients. Coaches advise from food logs, but typing every meal is a chore, so they see half the picture.

## Features

**Clients**
- Create an account, join a coach with an invite code (at sign-up or later)
- Log a meal from a photo (camera or upload, drag and drop), choose breakfast/lunch/dinner/snack
- Edit AI estimates (add, remove or change foods); corrected meals are flagged for the coach
- Daily calorie ring, macro bars, 7-day chart, streaks, 7/30-day progress and an AI weekly insight
- Browse earlier days, see coach replies (with unread badge)
- Export all data as JSON, change password, delete the account

**Coaches**
- Dashboard of all clients for today: who has logged, who has not, who needs a reply, streaks
- Search and filter, open any client for a 14-day chart and day-by-day meals
- Reply to meals (with quick replies), AI weekly summary per client
- Invite code (copy code or link), rotate it any time, remove clients

## Stack

| Layer | Choice |
|---|---|
| Hosting | Vercel (static files + one serverless function, `api/index.js`) |
| Database | PostgreSQL (Neon via the Vercel Marketplace). Embedded Postgres (PGlite) for local dev and tests |
| Auth | Email + password (scrypt), opaque session tokens (SHA-256 hashed in the DB), `HttpOnly` `SameSite=Lax` `Secure` cookie, 30-day sessions |
| AI | Google Gemini (photo analysis and summaries), output validated and clamped |
| Front end | Plain HTML/CSS/JS, no build step |
| Tests | `node:test` against the real API on an in-memory Postgres |

```
api/index.js        Vercel entry point
lib/                http layer, auth, validation, AI, db adapter, route modules
  routes/           auth, me, meals, coach
migrations/         numbered SQL files, applied automatically (advisory-locked, idempotent)
public/             index.html, app.js, styles.css, theme.js
scripts/dev.js      local server (real API + embedded Postgres)
tests/              API test suite
```

## Run locally

```bash
npm install
npm run dev        # http://localhost:4173
npm test
```

No database or AI key is needed locally: the dev server uses an embedded Postgres (stored in `.data/`) and a fake AI that returns sample meals. Set `GEMINI_API_KEY` for real photo analysis, or `DATABASE_URL` to develop against a real Postgres.

## Deploy (Vercel + Neon)

1. In Vercel, open the project, go to **Storage** (or Marketplace) and add **Neon Postgres**. This sets `DATABASE_URL` for you. Enable it for Production and Preview.
2. Keep `GEMINI_API_KEY` set in the project's environment variables.
3. Merge to `main`. Tables are created automatically on the first request (or run `npm run migrate`).

Environment variables are listed in `.env.example`.

## API

All endpoints are under `/api`, JSON in and out, errors look like `{"error":{"code","message"}}`. Session cookie required unless noted.

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | no auth |
| POST | `/auth/register`, `/auth/login`, `/auth/logout` | rate limited |
| GET / PATCH / DELETE | `/me` | profile, goal, timezone; DELETE needs password |
| POST | `/me/password`, `/me/coach` | change password (signs out other devices); join coach by code |
| DELETE | `/me/coach` | leave coach |
| GET | `/me/export` | all of your data |
| GET / POST | `/meals` | list a day (`?date=YYYY-MM-DD`) / log a meal from a photo (client) |
| PATCH / DELETE | `/meals/:id` | owner only |
| GET | `/meals/:id/image` | owner or their coach only |
| POST | `/meals/:id/replies` | coach of the client only |
| GET | `/stats?days=`, `/insights` | client progress and AI summary |
| POST | `/replies/read` | mark coach replies as seen |
| GET | `/coach/overview` | clients for today (or `?date=`) |
| GET | `/coach/clients/:id`, `/coach/clients/:id/insights` | |
| DELETE | `/coach/clients/:id` | unlink a client |
| POST | `/coach/invite/rotate` | new invite code |

## Security and privacy

- Passwords hashed with scrypt; login timing is the same for unknown emails; per-IP and per-email rate limits (stored in the database so they work across serverless instances)
- Meal photos are private: stored in Postgres and only served to the owner and their linked coach (everyone else gets 404)
- Strict Content-Security-Policy (no inline scripts), `X-Frame-Options`, `nosniff`, referrer and permissions policies
- Cross-site state-changing requests rejected (`Origin` / `Sec-Fetch-Site` checks on top of `SameSite=Lax`)
- All input validated with Zod; uploads checked for type, size and file signature; AI output validated and clamped; user notes are passed to the model as data
- Users can export or permanently delete their data
- Structured JSON logs with request ids; no request bodies or photos are logged

## Limits (honest)

- Portion estimates from a photo are approximate; the correction step exists for that reason
- No email verification or password reset yet (needs an email provider); no push notifications
- AI calls are capped per user per hour to control cost
- Data from before v2 (the old name-only accounts) is not migrated
