/**
 * TypeScript types for Robinhood API response shapes.
 *
 * These match the actual fields returned by api.robinhood.com.
 * Used to type the RobinhoodClient stub methods so future implementors
 * know exactly what the live API returns.
 *
 * Reference: unofficial Robinhood API documentation
 */

// ── Auth ────────────────────────────────────────────────────────────────────

export interface RobinhoodTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number; // seconds, typically 86400
  scope: string;
  mfa_required?: boolean;
  mfa_type?: "app" | "sms";
}

// ── Portfolio ────────────────────────────────────────────────────────────────

export interface RobinhoodPortfolio {
  url: string;
  account: string; // account URL
  start_date: string;
  market_value: string; // decimal string e.g. "49100.3100"
  equity: string; // market_value + cash
  extended_hours_equity: string | null;
  extended_hours_market_value: string | null;
  last_core_equity: string;
  last_core_market_value: string;
  excess_margin: string;
  excess_maintenance: string;
  excess_margin_with_uncleared_deposits: string;
  excess_maintenance_with_uncleared_deposits: string;
  unwithdrawable_deposits: string;
  unwithdrawable_grants: string;
  withdrawable_amount: string;
  adjusted_equity_previous_close: string;
  equity_previous_close: string;
  net_return: string;
}

export interface RobinhoodAccount {
  url: string;
  id: string;
  account_number: string;
  type: "margin" | "cash";
  cash: string;
  cash_available_for_withdrawal: string;
  buying_power: string;
  cash_held_for_orders: string;
  uncleared_deposits: string;
  sma: string;
  sma_held_for_orders: string;
  margin_balances: {
    day_trade_buying_power: string;
    overnight_buying_power: string;
    cash: string;
  };
  portfolio: string; // portfolio URL
  created_at: string;
  updated_at: string;
}

// ── Positions ────────────────────────────────────────────────────────────────

export interface RobinhoodPosition {
  url: string;
  instrument: string; // instrument URL — requires second call to resolve symbol
  instrument_id: string;
  account: string;
  account_number: string;
  quantity: string; // decimal string
  average_buy_price: string;
  equity: string;
  equity_cost: string;
  pending_average_buy_price: string;
  intraday_average_buy_price: string;
  intraday_quantity: string;
  shares_available_for_closing_short_position: string;
  shares_held_for_buys: string;
  shares_held_for_sells: string;
  shares_held_for_stock_grants: string;
  shares_held_for_options_collateral: string;
  shares_held_for_options_events: string;
  shares_pending_from_options_events: string;
  created_at: string;
  updated_at: string;
}

export interface RobinhoodInstrument {
  id: string;
  url: string;
  symbol: string;
  simple_name: string | null;
  name: string;
  tradeable: boolean;
  type: string;
}

// ── Options Positions ────────────────────────────────────────────────────────

export interface RobinhoodOptionsPosition {
  account: string;
  average_open_price: string;
  chain_id: string;
  chain_symbol: string;
  created_at: string;
  direction: "debit" | "credit";
  intraday_average_open_price: string;
  intraday_quantity: string;
  legs: RobinhoodOptionsLeg[];
  quantity: string;
  trade_value_multiplier: string;
  type: "long" | "short";
  updated_at: string;
}

export interface RobinhoodOptionsLeg {
  id: string;
  option: string; // option URL
  position_type: "long" | "short";
  quantity: string;
  ratio_quantity: number;
}

export interface RobinhoodOption {
  id: string;
  chain_id: string;
  chain_symbol: string;
  expiration_date: string;
  issue_date: string;
  min_ticks: { above_tick: string; below_tick: string; cutoff_price: string };
  rhs_tradability: string;
  state: string;
  strike_price: string;
  tradability: string;
  type: "call" | "put";
  url: string;
}

// ── Quotes ───────────────────────────────────────────────────────────────────

export interface RobinhoodQuote {
  symbol: string;
  bid_price: string;
  bid_size: number;
  ask_price: string;
  ask_size: number;
  last_trade_price: string;
  last_extended_hours_trade_price: string | null;
  previous_close: string;
  adjusted_previous_close: string;
  previous_close_date: string;
  symbol_id: string;
  trading_halted: boolean;
  has_traded: boolean;
  last_trade_price_source: string;
  updated_at: string;
  instrument: string;
  instrument_id: string;
  state: string;
}

// ── Watchlist ────────────────────────────────────────────────────────────────

export interface RobinhoodWatchlistItem {
  url: string;
  instrument: string; // instrument URL
  instrument_id: string;
  created_at: string;
  object: {
    id: string;
    symbol: string;
    name: string;
    simple_name: string | null;
  };
}

export interface RobinhoodWatchlist {
  url: string;
  user: string;
  name: string;
  securities: string; // URL to paginated securities list
}

// ── Orders (Activity) ────────────────────────────────────────────────────────

export interface RobinhoodOrder {
  id: string;
  ref_id: string;
  url: string;
  account: string;
  instrument: string;
  instrument_id: string;
  position: string;
  type: "market" | "limit" | "stop_loss" | "stop_limit";
  side: "buy" | "sell";
  time_in_force: "gfd" | "gtc" | "ioc" | "opg";
  trigger: "immediate" | "stop";
  price: string | null;
  stop_price: string | null;
  quantity: string;
  filled_quantity: string;
  cumulative_quantity: string;
  average_price: string | null;
  fees: string;
  state:
    | "queued"
    | "unconfirmed"
    | "confirmed"
    | "partially_filled"
    | "filled"
    | "rejected"
    | "cancelled"
    | "failed";
  created_at: string;
  updated_at: string;
  last_trail_price: string | null;
  executions: Array<{
    price: string;
    quantity: string;
    settlement_date: string;
    timestamp: string;
    id: string;
  }>;
}

export interface RobinhoodDividend {
  id: string;
  url: string;
  account: string;
  instrument: string;
  instrument_id: string;
  amount: string;
  rate: string;
  position: string;
  withholding: string;
  record_date: string;
  payable_date: string;
  paid_at: string | null;
  state: "announced" | "pending" | "reinvested" | "paid" | "voided";
  nra_withholding: string;
}

// ── Paginated response wrapper ────────────────────────────────────────────────

export interface RobinhoodPaginated<T> {
  next: string | null; // URL to next page
  previous: string | null;
  results: T[];
}

// ── Internal normalized types (used by our API) ───────────────────────────────

export type BrokerSource = "mock" | "robinhood";
