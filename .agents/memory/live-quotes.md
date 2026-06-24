---
name: Live Quotes Implementation
description: getQuotes() calls Robinhood's public quote endpoint — no auth needed, chunks 70 symbols, 8s timeout
---

# Live Quotes — Phase 2A

## Endpoint
`GET https://api.robinhood.com/quotes/?symbols=AAPL,SPY,...`

- **Auth:** None required. Returns HTTP 200 publicly. Bearer token used if `ROBINHOOD_ACCESS_TOKEN` is set (better rate limits).
- **Chunk size:** 70 symbols per request (Robinhood limit ~75)
- **Timeout:** 8s via `AbortSignal.timeout(8_000)`
- **Fallback:** Throws on HTTP error or malformed response → caller catches and uses mock data

## Response Shape
```json
{ "results": [{ "symbol", "last_trade_price", "previous_close", "bid_price", "ask_price", "updated_at", "trading_halted" }] }
```
All price fields are strings (e.g. "297.890000") — parse with `parseFloat()`.

## Key Files
- `artifacts/api-server/src/broker/robinhoodClient.ts` — `getQuotes()` method (LIVE)
- `artifacts/api-server/src/broker/config.ts` — `buildRequestHeaders()`, `getOptionalAccessToken()`
- `artifacts/api-server/src/routes/quotes.ts` — route handler + transform (was already written)

## Status of Other Broker Methods
All other methods in `robinhoodClient.ts` are stubs that throw NOT_IMPLEMENTED. Phase 2B (portfolio/account) requires `ROBINHOOD_ACCESS_TOKEN`.

**Why:** Quotes endpoint is public. All other Robinhood endpoints require authentication. Never implement order placement or approval actions in the broker client.
