# Project Instructions

- This repository uses Next.js 16 App Router, React, TypeScript, Tailwind CSS 4,
  better-sqlite3, and Playwright. Follow the installed Next.js documentation
  when its APIs differ from older examples.
- Use `proxy.ts` for early page redirects; Next.js 16 renamed the old
  `middleware.ts` convention. Protected API routes must still check
  `getSession()` themselves.
- Keep SQLite access synchronous and server-only in `lib/db.ts`. Use prepared
  statements and keep database initialization lazy so builds do not create or
  include runtime database files.
- Authentication is passkey-only. Use `@simplewebauthn` and `isoBase64URL` for
  credential encoding; coalesce authenticator counters with `?? 0`.
- Keep all passkeys for an account on its same opaque WebAuthn user handle.
  Sessions use `lib/auth.ts`; never expose the session token to client code.
- Use Singapore timezone helpers for future user-facing date and time features.
- Run `npm run lint`, `npm run test:unit`, and `npm run test:e2e` when changing
  authentication behavior. E2E tests use Chromium virtual authenticators.
