import { BaseBrokerClient } from "./brokerClient.js";

/**
 * Webull broker client — placeholder.
 *
 * TODO: Implement against Webull's brokerage API once access and the
 * authenticated trading flow are in place. All methods currently throw
 * "not implemented" via BaseBrokerClient, so routes fall back to mock data.
 */
class WebullClient extends BaseBrokerClient {
  readonly brokerId = "webull";
}

export const webullClient = new WebullClient();
