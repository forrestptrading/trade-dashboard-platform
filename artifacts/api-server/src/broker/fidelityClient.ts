import { BaseBrokerClient } from "./brokerClient.js";

/**
 * Fidelity broker client — placeholder.
 *
 * TODO: Implement against Fidelity's brokerage API once access and the
 * authenticated trading flow are in place. All methods currently throw
 * "not implemented" via BaseBrokerClient, so routes fall back to mock data.
 */
class FidelityClient extends BaseBrokerClient {
  readonly brokerId = "fidelity";
}

export const fidelityClient = new FidelityClient();
