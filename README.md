# AI SDLC Todo App

Passwordless authentication for the Todo App using WebAuthn passkeys, JWT
sessions, and SQLite.

## Requirements

- Node.js 22 or later
- npm
- A browser with WebAuthn support

## Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local`.
3. Set `SESSION_SECRET` to a random value of at least 32 bytes. For example:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
4. Configure `RP_ID` and `RP_ORIGIN` for the domain you use. For local
   development, the example values use `localhost`.
5. Run `npm run dev` and open `http://localhost:3000`.

The SQLite database is created as `data/todos.db`. Set `DATABASE_PATH` to a
different filename inside `data/`.

## Commands

- `npm run dev` starts the development server.
- `npm run build` creates a production build.
- `npm run lint` runs ESLint.
- `npm run seed:holidays` seeds Singapore public holidays for 2025–2027.
  Run this after setup and against each deployment's persistent database.
  Re-running it updates names without duplicating dates or removing other years.
- `npm run test:unit` runs authentication, todo, and calendar unit tests.
- `npm run test:e2e` runs the Playwright authentication, todo, priority, and calendar suites.

## Calendar

Choose **Calendar** from the home page to see a fixed six-week Sun–Sat grid.
`/calendar?month=2026-11` opens a specific month; malformed values fall back to
the current Singapore month. Previous/Next/Today replace the URL rather than
adding history entries. The calendar uses the existing unfiltered `/api/todos`
array response, including completed tasks and excluding undated tasks.

`GET /api/holidays` returns `{ holidays: [{ id, date, name }] }` and requires
authentication. Supply both `year=YYYY&month=MM` to restrict results to the full
42-day visible grid, including adjacent months; invalid parameters return 400.
The table is global, with one holiday per date. Seed data comes from the
[Ministry of Manpower](https://www.mom.gov.sg/employment-practices/public-holidays)
and includes Sunday rest-day replacements. Other years remain navigable but
have no holidays until verified data is added to `lib/holidays.ts` and seeded.

Next.js 16 renamed the `middleware.ts` convention to `proxy.ts`; `proxy.ts`
protects `/` and `/calendar` and redirects unauthenticated visitors to `/login`.
All authentication API routes verify sessions or passkey challenges independently.
Each account stores an opaque WebAuthn user handle so additional passkeys share
the same account identity.

See [USER_GUIDE.md](./USER_GUIDE.md) for registration, login, and passkey
management details.