---
name: Broker Manager architecture (api-server)
description: How multi-broker support is structured in the trading dashboard API and the conventions routes must follow.
---

# Broker Manager layer

All broker communication in `artifacts/api-server` goes through a common
`BrokerClient` interface + a registry `manager.ts` (`getBroker(id?)`,
`getDefaultBroker`, `listBrokers`; default `"robinhood"`). Routes never import a
concrete client — they call `getBroker(req.query["broker"])`.

Placeholder brokers (schwab, fidelity, sofi, webull, interactiveBrokers) extend
`BaseBrokerClient`, which makes every method throw "not implemented" and
`isAuthenticated()` return false. So selecting an unimplemented broker simply
falls back to mock data via the existing live-failure catch.

## Conventions routes MUST follow
- Resolve the broker **inside** the `if (useLiveData()) { try { ... } }` block,
  never before it. `getBroker` throws on an unknown id by design; resolving it
  outside the try makes a bad `?broker=` query param 500 instead of falling back
  to mock. (This was a real regression that got caught in review.)
- Report `source: broker.brokerId` in live-success responses, not a hardcoded
  `"robinhood"`. `brokerId` is on the `BrokerClient` interface for this purpose.

**Why:** the goal is adding new brokers without editing routes or the frontend.
Hardcoded sources and pre-block broker resolution both break that goal.

## Read-only stance
`placeOrder`/`cancelOrder` are intentionally throw-only on RobinhoodClient — the
app is read-only. Re-enabling trading requires an explicit, audited opt-in.
