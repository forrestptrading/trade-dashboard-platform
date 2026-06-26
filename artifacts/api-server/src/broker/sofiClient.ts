import { BaseBrokerClient } from "./brokerClient.js";

/**
 * SoFi Invest broker client — placeholder.
 *
 * TODO: Implement against SoFi's brokerage API once access and the
 * authenticated trading flow are in place. All methods currently throw
 * "not implemented" via BaseBrokerClient, so routes fall back to mock data.
 */
class SofiClient extends BaseBrokerClient {
  readonly brokerId = "sofi";
}

export const sofiClient = new SofiClient();
