---
name: Auth foundation (api-server)
description: How user authentication works in the trading dashboard API and the conventions to follow when extending it.
---

# Authentication model

Server-side **session** auth (not JWT). Flow:
- Password hashing: Node built-in `crypto.scrypt` (per-password random salt,
  `timingSafeEqual`), stored as `scrypt$<saltHex>$<hashHex>` in `users.password_hash`.
  No native dep, bundles cleanly with esbuild. Never store plaintext.
- Session token: random 32-byte hex in an **httpOnly** cookie named `sid`. Only the
  SHA-256 hash of the token is stored in `sessions.token_hash`, so a DB leak exposes
  no usable tokens. Logout = delete the session row (fully revocable).
- Endpoints live in `routes/auth.ts`, mounted under the `/api` router → real paths
  are `/api/auth/register|login|logout|me`.
- Middleware in `middlewares/auth.ts`: `requireAuth` (401 if no valid session) and
  `optionalAuth` (attaches `req.user` if present, never blocks). `req.user` is added
  via a `declare global Express.Request` augmentation in that file.

## Conventions when extending
- Existing data routes are intentionally **public** (mock/demo for anonymous users).
  Do NOT slap `requireAuth` on them without explicit instruction — backward compat
  requirement. Use `optionalAuth` if a route should personalize when logged in.
- Login runs a constant-time dummy `verifyPassword` when the user is not found to
  blunt user-enumeration timing. Keep that pattern.
- Register pre-checks email then catches Postgres unique-violation (`code === "23505"`)
  to return 409 on the concurrent-insert race — not 500.
- CORS is `cors({ origin: true, credentials: true })` so cookies work whether the
  frontend is same-origin (Vite dev proxy `/api` → :8080) or cross-origin.

## Deferred hardening (not done this sprint, by design)
CSRF tokens (would require frontend changes), login/register rate limiting/lockout.
Trading and live broker credential storage are explicitly out of scope.

## Forward-looking schema (in lib/db/src/schema/)
Tables created to prepare for later sprints, FK → users with `onDelete: cascade`:
`broker_connections` (multi-broker per user; `encrypted_credentials` is a
placeholder — encrypted-only, never plaintext), `user_settings`, `watchlists` +
`watchlist_items`, `journal_entries`, `ai_preferences`. Apply schema with
`pnpm --filter @workspace/db run push`.
