import type { BrokerClient } from "./brokerClient.js";
import { getBroker, getDefaultBroker } from "./manager.js";
import type { NormalizedBrokerSnapshot } from "./model.js";

/**
 * Broker Engine v1 orchestration layer.
 *
 * Routes should depend on this module for normalized broker snapshots rather
 * than importing a specific adapter. The engine keeps the current Robinhood and
 * Plaid flows intact while providing one backend contract for future brokers.
 */
export class BrokerEngine {
  constructor(private readonly defaultBroker: BrokerClient = getDefaultBroker()) {}

  resolveBroker(brokerId?: string | null): BrokerClient {
    return brokerId ? getBroker(brokerId) : this.defaultBroker;
  }

  async getSnapshot(brokerId?: string | null): Promise<NormalizedBrokerSnapshot> {
    return this.resolveBroker(brokerId).getNormalizedSnapshot();
  }
}

export const brokerEngine = new BrokerEngine();
