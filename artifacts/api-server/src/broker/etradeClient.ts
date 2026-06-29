import { BaseBrokerClient } from "./brokerClient.js";

/**
 * E*TRADE broker client — Broker Engine v1 adapter stub.
 *
 * TODO: Implement against the E*TRADE API once OAuth credentials and account
 * entitlements are configured. The stub keeps the broker registered without
 * adding real auth or trading behavior in this architecture-focused phase.
 */
class EtradeClient extends BaseBrokerClient {
  readonly brokerId = "etrade";
}

export const etradeClient = new EtradeClient();
