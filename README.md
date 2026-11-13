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
- `npm run test:unit` runs token and authenticator-counter unit tests.
- `npm run test:e2e` runs the Playwright authentication suite.

Next.js 16 renamed the `middleware.ts` convention to `proxy.ts`; `proxy.ts`
protects `/` and `/calendar` and redirects unauthenticated visitors to `/login`.
All authentication API routes verify sessions or passkey challenges independently.
Each account stores an opaque WebAuthn user handle so additional passkeys share
the same account identity.

See [USER_GUIDE.md](./USER_GUIDE.md) for registration, login, and passkey
management details.