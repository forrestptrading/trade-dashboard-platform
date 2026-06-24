---
name: Vite Proxy Fix
description: The trading-dashboard Vite dev server must proxy /api/* to port 8080 or the frontend gets HTML instead of JSON
---

# Vite Proxy — Critical Fix

## The Problem
The frontend makes relative `/api/*` fetch calls. Without a proxy, these hit the Vite dev server (port 24210) which returns an HTML SPA fallback — not JSON. React Query silently fails; all portfolio/positions/watchlist values show as $0.00.

## The Fix
`artifacts/trading-dashboard/vite.config.ts` — `server.proxy` block:

```typescript
server: {
  proxy: {
    "/api": {
      target: "http://localhost:8080",
      changeOrigin: true,
    },
  },
}
```

**Why:** Vite proxy only applies in dev mode. In production (deployed), Replit's routing proxy handles same-domain path routing — `/api/*` goes to the API server (port 80), frontend served separately. Both environments work after this fix.

**How to apply:** This is already in place. Do not remove it. If the frontend ever stops showing data in dev, check this proxy block first.
