import type { BrokerProviderId } from "./model.js";

export interface BrokerCapabilities {
  supportsHoldings: boolean;
  supportsOptions: boolean;
  supportsTransactions: boolean;
  supportsDividends: boolean;
  supportsOrders: boolean;
  supportsRealTimeQuotes: boolean;
  supportsHistory: boolean;
}

export const BROKER_CAPABILITY_MATRIX: Record<BrokerProviderId, BrokerCapabilities> = {
  robinhood: {
    supportsHoldings: true,
    supportsOptions: true,
    supportsTransactions: true,
    supportsDividends: true,
    supportsOrders: false,
    supportsRealTimeQuotes: true,
    supportsHistory: false,
  },
  fidelity: {
    supportsHoldings: false,
    supportsOptions: false,
    supportsTransactions: false,
    supportsDividends: false,
    supportsOrders: false,
    supportsRealTimeQuotes: false,
    supportsHistory: false,
  },
  vanguard: {
    supportsHoldings: false,
    supportsOptions: false,
    supportsTransactions: false,
    supportsDividends: false,
    supportsOrders: false,
    supportsRealTimeQuotes: false,
    supportsHistory: false,
  },
  sofi: {
    supportsHoldings: false,
    supportsOptions: false,
    supportsTransactions: false,
    supportsDividends: false,
    supportsOrders: false,
    supportsRealTimeQuotes: false,
    supportsHistory: false,
  },
  webull: {
    supportsHoldings: false,
    supportsOptions: false,
    supportsTransactions: false,
    supportsDividends: false,
    supportsOrders: false,
    supportsRealTimeQuotes: false,
    supportsHistory: false,
  },
  schwab: {
    supportsHoldings: false,
    supportsOptions: false,
    supportsTransactions: false,
    supportsDividends: false,
    supportsOrders: false,
    supportsRealTimeQuotes: false,
    supportsHistory: false,
  },
  "interactive-brokers": {
    supportsHoldings: false,
    supportsOptions: false,
    supportsTransactions: false,
    supportsDividends: false,
    supportsOrders: false,
    supportsRealTimeQuotes: false,
    supportsHistory: false,
  },
  etrade: {
    supportsHoldings: false,
    supportsOptions: false,
    supportsTransactions: false,
    supportsDividends: false,
    supportsOrders: false,
    supportsRealTimeQuotes: false,
    supportsHistory: false,
  },
};

export function getBrokerCapabilities(brokerId: BrokerProviderId): BrokerCapabilities {
  return BROKER_CAPABILITY_MATRIX[brokerId];
}
