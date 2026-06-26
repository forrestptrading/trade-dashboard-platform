import { BaseBrokerClient } from "./brokerClient.js";

/**
 * Charles Schwab broker client — placeholder.
 *
 * TODO: Implement against the Schwab Trader API once OAuth credentials and the
 * authenticated trading flow are in place. All methods currently throw
 * "not implemented" via BaseBrokerClient, so routes fall back to mock data.
 */
class SchwabClient extends BaseBrokerClient {
  readonly brokerId = "schwab";
}

export const schwabClient = new SchwabClient();
