---
name: Trading dashboard frontend auth
description: How the React dashboard consumes session auth while keeping anonymous/demo mode the default.
---

# Frontend auth wiring (trading-dashboard)

AuthProvider wraps the app inside QueryClientProvider and drives state from a
`useQuery(['/api/auth/me'])`.

**Rule: a 401 from `/me` is NOT an error — it means anonymous/demo mode.**
The query's `retry` callback returns false on `ApiError.status === 401`, so the
dashboard never blocks behind login and renders mock/sample data by default.

**Why:** Sprint 5 requirement #4 — anonymous mode must keep working; routes are
intentionally ungated. The backend leaves data routes public on purpose (see
auth-foundation.md), so the frontend only layers a *display* of auth state, not
a gate.

**How to apply:**
- After login/register/logout, call the context's refresh/logout which
  `invalidateQueries` on session-scoped keys (ai/trades, notifications,
  analytics/portfolio, risk) so user-specific data appears or reverts to demo.
- All auth calls go through `auth-api.ts` with `credentials:"include"`; cookies
  also flow via the same-origin Vite proxy to :8080.
- `authErrorMessage()` maps 400 weak-pw / 409 dup-email / 401 invalid-or-expired
  to friendly copy; reuse it for any new auth UI rather than re-deriving.
