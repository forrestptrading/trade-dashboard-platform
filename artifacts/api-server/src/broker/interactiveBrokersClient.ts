import { BaseBrokerClient } from "./brokerClient.js";

/**
 * Interactive Brokers (IBKR) broker client — placeholder.
 *
 * TODO: Implement against the IBKR Client Portal / Web API once access and the
 * authenticated trading flow are in place. All methods currently throw
 * "not implemented" via BaseBrokerClient, so routes fall back to mock data.
 */
class InteractiveBrokersClient extends BaseBrokerClient {
  readonly brokerId = "interactive-brokers";
}

export const interactiveBrokersClient = new InteractiveBrokersClient();
