---
name: Trading Dashboard Project Status
description: Full status of the trading dashboard build — what's done, environment config, and what's next
---

# Trading Dashboard — Project Status

## Architecture
- **Monorepo** (pnpm workspace): `artifacts/api-server` (Express, port 8080) + `artifacts/trading-dashboard` (React/Vite, port 24210)
- **API client:** `lib/api-client-react/` — generated via orval, uses `customFetch` with relative paths, no `setBaseUrl` needed in browser
- **Routing:** Vite proxies `/api/*` → `localhost:8080` (added in vite.config.ts). Production Replit proxy handles same-domain routing.
- **Port mapping (.replit):** 8080→80 (API, primary), 24210→3000 (frontend), 8081→8081 (mockup sandbox)

## Environment Variables (Replit Secrets)
- `USE_LIVE_DATA = true` — set in shared env. When true, routes try live broker; fall back to mock on error.
- `ROBINHOOD_ACCESS_TOKEN` — optional. Not set. Quotes work without it (public endpoint).

## Phase 2A — COMPLETE ✅
- `getQuotes()` in `artifacts/api-server/src/broker/robinhoodClient.ts` is LIVE
- Calls `https://api.robinhood.com/quotes/?symbols=...` (public, no auth required)
- Chunks symbols in groups of 70, 8s timeout, falls back to mock on error
- `source: "robinhood"` in response when live; `source: "mock"` when fallback
- Helper functions added to `broker/config.ts`: `getOptionalAccessToken()`, `buildRequestHeaders()`

## Current Mock Portfolio Values (TEST VALUES — revert before production)
- total_value: 999,999.99
- buying_power: 88,888.88
- cash: 77,777.77
- day_change: 6,666.66
- day_change_percent: 12.34
- File: `artifacts/api-server/src/routes/portfolio.ts` — MOCK_PORTFOLIO const

## All 20 API Routes
All routes intact. 7 are mock/live switchable (portfolio, positions, quotes, watchlist, optionsPositions, accountActivity, marketSummary). All return `source` field.
Approvals system (POST/GET /api/approvals/*) is in-memory only, not switchable.

## What's Next (not started)
- **Phase 2B:** Live `getPortfolio()` + `getAccount()` using `ROBINHOOD_ACCESS_TOKEN` — Overview page shows real portfolio value/cash balance. Requires auth token.
- Revert test mock values back to realistic numbers before going live.

## Key Files
- `artifacts/api-server/src/broker/robinhoodClient.ts` — broker integration (getQuotes live, rest stubs)
- `artifacts/api-server/src/broker/config.ts` — USE_LIVE_DATA flag, token helpers
- `artifacts/api-server/src/broker/types.ts` — full Robinhood TypeScript types
- `artifacts/api-server/src/routes/portfolio.ts` — MOCK_PORTFOLIO const (has test values right now)
- `artifacts/trading-dashboard/vite.config.ts` — Vite proxy config (critical fix added)
- `lib/api-client-react/src/custom-fetch.ts` — base fetch client
