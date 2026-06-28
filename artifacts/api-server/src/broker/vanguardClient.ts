import { BaseBrokerClient } from "./brokerClient.js";

/**
 * Vanguard broker client — Broker Engine v1 adapter stub.
 *
 * TODO: Implement once an approved Vanguard/Plaid investment data path is chosen.
 * All methods currently throw via BaseBrokerClient so existing routes fall back
 * to mock/offline behavior instead of pretending live data is available.
 */
class VanguardClient extends BaseBrokerClient {
  readonly brokerId = "vanguard";
}

export const vanguardClient = new VanguardClient();
