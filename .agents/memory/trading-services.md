---
name: Trading workspace services (analytics, risk, performance, AI trades, notifications)
description: How the Sprint-3 service layer is structured and the conventions to keep when extending it.
---

# Service layer (api-server)

`src/services/` holds **pure computation** (no I/O); routes obtain data and call services.
- `portfolioData.ts` — the single source of holdings. `getPortfolioSnapshot(broker)`
  returns a normalized `PortfolioSnapshot` from live broker data when
  `useLiveData() && broker.isAuthenticated()`, else a rich `mockSnapshot()`. Any
  broker error falls back to mock. Analytics and risk both consume this snapshot,
  so they share one data shape. Sector comes from a static `SECTOR_MAP` (broker
  data has no sector); unknown → "Other".
- `analyticsService.ts` — `computePortfolioAnalytics(snapshot)`. Diversification
  score = normalized Herfindahl index, 60% per-asset + 40% per-sector, 0–100.
- `riskService.ts` — `computeRiskReport(snapshot)`. Beta is a market-weighted
  estimate from a static `BETA_MAP`; beta and max-drawdown are **placeholders**
  flagged with `*IsPlaceholder: true` until price history is wired through the
  broker abstraction. Don't silently drop the placeholder flags.
- `performanceService.ts` — mock daily/weekly/monthly/yearly; `isPlaceholder: true`.

## Route conventions for new per-user resources
DB-backed per-user resources (`ai_trades`, `notifications`) follow one pattern:
- **Reads** use `optionalAuth`: authenticated → that user's rows (`source: "db"`);
  anonymous → demo mock array (`source: "mock"`). This keeps the frontend working
  for anonymous/demo users (Sprint-1 requirement) while scoping real data per user.
- **Writes** (`requireAuth`) always scope by `userId` in the WHERE clause, so a
  user can only touch their own rows (404 otherwise).
- AI trade status lifecycle is enforced: approve/reject require `Pending`,
  execute requires `Approved`; wrong state → 409. Statuses are capitalized
  exactly: `Pending|Approved|Rejected|Executed`. No real trade is ever placed.

## Gotchas
- **Project references**: `lib/db` is a composite TS project. After adding/altering
  a schema file you MUST rebuild its declarations (`tsc -b lib/db`) or api-server
  typecheck fails with "has no exported member" — it reads `lib/db/dist/*.d.ts`,
  not src. `pnpm --filter @workspace/db run push` does NOT rebuild declarations.
- **Express 5**: `req.params.id` is typed `string | string[]`; wrap with
  `String(req.params.id)` before passing to drizzle `eq()` / typed string params.
