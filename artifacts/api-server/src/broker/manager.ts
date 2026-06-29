/**
 * BrokerManager — central registry for all broker clients.
 *
 * Routes obtain a broker through this manager instead of importing a specific
 * client. This keeps broker-specific logic out of the route layer and lets new
 * brokers be added by registering them here — no route or frontend changes.
 *
 * This file intentionally contains NO broker-specific logic. It only registers
 * clients and resolves them by id.
 */

import type { BrokerClient } from "./brokerClient.js";
import { robinhoodClient } from "./robinhoodClient.js";
import { schwabClient } from "./schwabClient.js";
import { fidelityClient } from "./fidelityClient.js";
import { sofiClient } from "./sofiClient.js";
import { webullClient } from "./webullClient.js";
import { interactiveBrokersClient } from "./interactiveBrokersClient.js";
import { vanguardClient } from "./vanguardClient.js";
import { etradeClient } from "./etradeClient.js";
import type { BrokerProviderId } from "./model.js";

export type BrokerId = BrokerProviderId;

/** The broker used when a caller does not specify one. */
export const DEFAULT_BROKER_ID: BrokerId = "robinhood";

const registry: Record<BrokerId, BrokerClient> = {
  robinhood: robinhoodClient,
  schwab: schwabClient,
  fidelity: fidelityClient,
  sofi: sofiClient,
  webull: webullClient,
  "interactive-brokers": interactiveBrokersClient,
  vanguard: vanguardClient,
  etrade: etradeClient,
};

/**
 * Resolve a broker by id. Falls back to the default broker (robinhood) when
 * no id is supplied. Throws if an unknown id is requested.
 */
export function getBroker(id?: string | null): BrokerClient {
  if (!id) return registry[DEFAULT_BROKER_ID];

  const normalized = id.toLowerCase().trim() as BrokerId;
  const broker = registry[normalized];

  if (!broker) {
    throw new Error(
      `[BrokerManager] Unknown broker "${id}". Available: ${Object.keys(registry).join(", ")}`,
    );
  }

  return broker;
}

/** Returns the default broker (robinhood). */
export function getDefaultBroker(): BrokerClient {
  return registry[DEFAULT_BROKER_ID];
}

/** Returns the list of registered broker ids. */
export function listBrokers(): BrokerId[] {
  return Object.keys(registry) as BrokerId[];
}
