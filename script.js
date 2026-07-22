"use strict";

const BACKEND_URL = "https://trade-dashboard-api--forrestpbusines.replit.app";
const DEFAULT_WATCHLIST = ["AAPL", "TSLA", "NVDA", "SPY", "QQQ"];
const STORAGE_KEYS = {
  watchlist: "fp_watchlist",
  journal: "fp_trade_journal",
  goal: "fp_portfolio_goal",
  session: "fp_dashboard_session"
};

let watchlist = loadStoredJson(STORAGE_KEYS.watchlist, DEFAULT_WATCHLIST);
let journalEntries = loadStoredJson(STORAGE_KEYS.journal, []);
let sessionToken = loadStoredText(STORAGE_KEYS.session);
let currentUser = null;
let portfolio = emptyPortfolio();
let connections = [];
let quotes = {};
let authBusy = false;
let connectBusy = false;

function emptyPortfolio() {
  return {
    source: "snaptrade",
    total_value: 0,
    cash: 0,
    buying_power: 0,
    invested_value: 0,
    day_change: null,
    day_change_percent: null,
    accounts: [],
    holdings: [],
    open_positions: 0,
    data_as_of: null,
    retrieved_at: null,
    data_freshness: []
  };
}

function loadStoredJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function loadStoredText(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function saveStoredJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn("Local storage write failed:", error);
  }
}

function saveSessionToken(token) {
  sessionToken = token || "";
  try {
    if (sessionToken) localStorage.setItem(STORAGE_KEYS.session, sessionToken);
    else localStorage.removeItem(STORAGE_KEYS.session);
  } catch (error) {
    console.warn("Session storage write failed:", error);
  }
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeTicker(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatCurrency(value) {
  return finiteNumber(value).toLocaleString("en-US", {
    style: "currency",
    currency: "USD"
  });
}

function formatNumber(value, maximumFractionDigits = 6) {
  return finiteNumber(value).toLocaleString("en-US", { maximumFractionDigits });
}

function formatTimestamp(value, unavailable = "Unavailable") {
  if (!value) return unavailable;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? unavailable : date.toLocaleString();
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setStatus(id, text, connected = false) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = text;
  element.className = `status-pill ${connected ? "status-connected" : "status-coming"}`;
}

async function apiFetchJson(path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {})
  };
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;

  const response = await fetch(`${BACKEND_URL}${path}`, {
    credentials: "include",
    cache: "no-store",
    ...options,
    headers
  });

  const issuedToken = response.headers.get("X-Session-Token");
  if (issuedToken) saveSessionToken(issuedToken);

  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    const error = new Error(result?.error || `Request failed with HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return result;
}

function activateDashboardSection(sectionId) {
  document.querySelectorAll(".nav-btn[data-section]").forEach((button) => {
    button.classList.toggle("active", button.dataset.section === sectionId);
  });
  document.querySelectorAll(".page-section").forEach((section) => {
    section.classList.toggle("active-section", section.id === sectionId);
  });
}

globalThis.activateDashboardSection = activateDashboardSection;

let navigationListenerInstalled = false;

function setupNavigation() {
  if (navigationListenerInstalled) return;
  navigationListenerInstalled = true;
  document.addEventListener("click", (event) => {
    const button = event.target.closest(".nav-btn[data-section]");
    if (!button) return;
    const sectionId = button.dataset.section;
    if (!sectionId || !document.getElementById(sectionId)) return;
    activateDashboardSection(sectionId);
  });
}

function setupFormsAndButtons() {
  document.getElementById("addTickerForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("tickerInput");
    const symbol = normalizeTicker(input?.value);
    if (!symbol || watchlist.includes(symbol)) return;
    watchlist.push(symbol);
    saveStoredJson(STORAGE_KEYS.watchlist, watchlist);
    if (input) input.value = "";
    fetchQuotes();
  });

  document.getElementById("authForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitAuth("login");
  });
  document.getElementById("registerBtn")?.addEventListener("click", () => submitAuth("register"));
  document.getElementById("logoutBtn")?.addEventListener("click", logout);
  document.getElementById("connectBrokerageBtn")?.addEventListener("click", connectBrokerage);
  document.getElementById("refreshDataBtn")?.addEventListener("click", refreshAllData);
  document.getElementById("saveGoalBtn")?.addEventListener("click", saveGoal);

  document.getElementById("journalForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const ticker = normalizeTicker(document.getElementById("journalTicker")?.value);
    const strategy = document.getElementById("journalStrategy")?.value?.trim() || "";
    const result = document.getElementById("journalResult")?.value?.trim() || "";
    if (!ticker && !strategy && !result) return;
    journalEntries.unshift({ ticker, strategy, result, created_at: new Date().toISOString() });
    saveStoredJson(STORAGE_KEYS.journal, journalEntries);
    event.target.reset();
    renderJournal();
  });
}

async function checkBackendHealth() {
  try {
    const result = await apiFetchJson("/api/health");
    setText("backendStatus", "Live");
    document.getElementById("backendStatus")?.classList.add("positive");
    setText("backendHealthStatus", `API is live. Checked ${formatTimestamp(result.timestamp)}.`);
  } catch (error) {
    setText("backendStatus", "Offline");
    document.getElementById("backendStatus")?.classList.add("negative");
    setText("backendHealthStatus", `API unavailable: ${error.message}`);
  }
}

async function checkAuth() {
  try {
    const result = await apiFetchJson("/api/auth/me");
    currentUser = result.data?.user || null;
  } catch {
    currentUser = null;
    if (sessionToken) saveSessionToken("");
  }
  renderAuth();
}

function renderAuth() {
  const signedIn = Boolean(currentUser);
  setStatus("authStatus", signedIn ? "Signed In" : authBusy ? "Working" : "Signed Out", signedIn);
  setText(
    "authMessage",
    signedIn ? `Signed in as ${currentUser.email}.` : "Use the owner email configured in the API environment."
  );

  ["authEmail", "authPassword", "loginBtn", "registerBtn"].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.hidden = signedIn;
  });
  const logoutButton = document.getElementById("logoutBtn");
  if (logoutButton) logoutButton.hidden = !signedIn;
  const connectButton = document.getElementById("connectBrokerageBtn");
  if (connectButton) connectButton.disabled = !signedIn || connectBusy;
}

async function submitAuth(mode) {
  if (authBusy) return;
  const email = document.getElementById("authEmail")?.value?.trim() || "";
  const password = document.getElementById("authPassword")?.value || "";
  if (!email || password.length < 8) {
    setText("authMessage", "Enter the configured owner email and a password of at least eight characters.");
    return;
  }

  authBusy = true;
  renderAuth();
  try {
    const result = await apiFetchJson(`/api/auth/${mode}`, {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    currentUser = result.data?.user || null;
    setBrokerageMessage("Signed in. Brokerage connection is ready.");
    await refreshPrivateData();
  } catch (error) {
    setText("authMessage", error.message);
  } finally {
    authBusy = false;
    renderAuth();
  }
}

async function logout() {
  try {
    await apiFetchJson("/api/snaptrade/logout", { method: "POST", body: "{}" });
  } catch (error) {
    console.warn("Logout request failed:", error);
  }
  saveSessionToken("");
  currentUser = null;
  portfolio = emptyPortfolio();
  connections = [];
  renderAuth();
  renderPortfolio();
  renderAccounts();
  renderConnections();
  renderHoldings();
  renderOptions();
  setBrokerageMessage("Signed out. Private brokerage data is hidden.");
}

function setBrokerageMessage(message, error = false) {
  const element = document.getElementById("brokerageStatusMessage");
  if (!element) return;
  element.textContent = message;
  element.className = `plaid-status ${error ? "negative" : "muted"}`;
}

async function checkSnapTradeConfig() {
  if (!currentUser) {
    setText("snapTradeConfigStatus", "SnapTrade configuration is checked after sign-in.");
    return;
  }
  try {
    const result = await apiFetchJson("/api/snaptrade/config-check");
    setText(
      "snapTradeConfigStatus",
      result.configured ? "SnapTrade Personal credentials are configured." : "SnapTrade credentials are missing."
    );
  } catch (error) {
    setText("snapTradeConfigStatus", `SnapTrade configuration check failed: ${error.message}`);
  }
}

async function connectBrokerage() {
  if (!currentUser || connectBusy) return;
  connectBusy = true;
  renderAuth();
  setBrokerageMessage("Requesting a secure SnapTrade connection link...");
  try {
    const result = await apiFetchJson("/api/snaptrade/connect", {
      method: "POST",
      body: "{}"
    });
    if (!result.redirect_uri) throw new Error("SnapTrade did not return a connection link");
    window.location.assign(result.redirect_uri);
  } catch (error) {
    connectBusy = false;
    renderAuth();
    setBrokerageMessage(error.message, true);
  }
}

function unwrapConnectionName(connection) {
  const brokerage = connection?.brokerage || connection?.broker || {};
  return brokerage.name || connection?.name || connection?.brokerage_name || "Brokerage";
}

async function fetchConnections() {
  if (!currentUser) {
    connections = [];
    renderConnections();
    return;
  }
  try {
    const result = await apiFetchJson("/api/snaptrade/connections");
    connections = safeArray(result.data);
  } catch (error) {
    connections = [];
    setBrokerageMessage(`Connections unavailable: ${error.message}`, true);
  }
  renderConnections();
}

async function fetchPortfolio() {
  if (!currentUser) {
    portfolio = emptyPortfolio();
    renderAllPortfolioViews();
    return;
  }
  try {
    const result = await apiFetchJson("/api/snaptrade/portfolio");
    if (result.source !== "snaptrade" || !result.data) {
      throw new Error("The API did not return a verified SnapTrade portfolio");
    }
    portfolio = {
      ...emptyPortfolio(),
      ...result.data,
      accounts: safeArray(result.data.accounts),
      holdings: safeArray(result.data.holdings),
      data_freshness: safeArray(result.data.data_freshness)
    };
    setBrokerageMessage(
      portfolio.accounts.length
        ? "Connected brokerage data loaded."
        : "SnapTrade is connected, but no investment accounts were returned."
    );
  } catch (error) {
    portfolio = emptyPortfolio();
    setBrokerageMessage(`Portfolio unavailable: ${error.message}`, true);
  }
  renderAllPortfolioViews();
}

function renderAllPortfolioViews() {
  renderPortfolio();
  renderAccounts();
  renderHoldings();
  renderOptions();
}

function renderPortfolio() {
  const accounts = safeArray(portfolio.accounts);
  const holdings = safeArray(portfolio.holdings).filter((holding) => !holding.cash_equivalent);
  const connected = accounts.length > 0;
  const dayChange = optionalFiniteNumber(portfolio.day_change);
  const dayPercent = optionalFiniteNumber(portfolio.day_change_percent);

  setText("portfolioValue", formatCurrency(portfolio.total_value));
  setText("buyingPower", formatCurrency(portfolio.buying_power));
  setText("cash", formatCurrency(portfolio.cash));
  setText("investedValue", formatCurrency(portfolio.invested_value));
  setText("dailyPL", dayChange === null ? "--" : formatCurrency(dayChange));
  setText("dailyPercent", dayPercent === null ? "Not supplied by brokerage feed" : `${dayPercent.toFixed(2)}%`);
  setText("openPositions", String(holdings.length));
  setText("accountCount", `${accounts.length} account${accounts.length === 1 ? "" : "s"} connected`);
  setText("portfolioSource", connected ? "SnapTrade connected data" : "SnapTrade not connected");
  setText("portfolioConnectionStatus", connected ? "Connected" : "Not Connected");
  setText("portfolioLastSync", `Data as of: ${formatTimestamp(portfolio.data_as_of, "Unavailable")}`);
  setText("portfolioDataSource", "Source: SnapTrade Personal");
  setText("dataFreshnessStatus", connected ? portfolio.freshness_label || "Reported" : "Unavailable");
  setText("dataRetrievedAt", `Retrieved: ${formatTimestamp(portfolio.retrieved_at, "Never")}`);
}

function renderAccounts() {
  const element = document.getElementById("accountsList");
  if (!element) return;
  const accounts = safeArray(portfolio.accounts);
  if (!currentUser) {
    element.innerHTML = '<article class="account-card"><h4>Private Portfolio</h4><span class="status-pill status-coming">Sign In Required</span><p class="muted">Sign in to view connected investment accounts.</p></article>';
    return;
  }
  if (!accounts.length) {
    element.innerHTML = '<article class="account-card"><h4>No Account Connected</h4><span class="status-pill status-coming">SnapTrade Ready</span><p class="muted">Use Connect Brokerage to link an investment account.</p></article>';
    return;
  }
  element.innerHTML = accounts.map((account) => {
    const number = String(account.account_number || "").replace(/\s+/g, "");
    const masked = number ? `•••• ${number.slice(-4)}` : "Hidden";
    return `
      <article class="account-card">
        <h4>${escapeHtml(account.name || "Investment Account")}</h4>
        <span class="status-pill status-connected">Connected</span>
        <p>Account: <strong>${escapeHtml(masked)}</strong></p>
        <p>Total Value: <strong>${formatCurrency(account.total_value)}</strong></p>
        <p>Cash: <strong>${formatCurrency(account.cash)}</strong></p>
        <p>Buying Power: <strong>${formatCurrency(account.buying_power)}</strong></p>
        <p class="muted">Data as of: ${escapeHtml(formatTimestamp(account.data_as_of))}</p>
      </article>`;
  }).join("");
}

function renderConnections() {
  const element = document.getElementById("brokerConnections");
  if (!element) return;
  if (!currentUser) {
    element.innerHTML = '<article class="broker-card"><h4>SnapTrade</h4><span class="status-pill status-coming">Sign In Required</span></article>';
    return;
  }
  if (!connections.length) {
    element.innerHTML = '<article class="broker-card"><h4>SnapTrade</h4><span class="status-pill status-coming">No Connection</span><p class="muted">No brokerage authorization has been returned.</p></article>';
    return;
  }
  element.innerHTML = connections.map((connection) => {
    const disabled = Boolean(connection.disabled) || String(connection.status || "").toLowerCase() === "disabled";
    return `
      <article class="broker-card">
        <h4>${escapeHtml(unwrapConnectionName(connection))}</h4>
        <span class="status-pill ${disabled ? "status-coming" : "status-connected"}">${disabled ? "Needs Attention" : "Connected"}</span>
        <p class="muted">Connection ID: ${escapeHtml(String(connection.id || connection.authorization_id || "Unavailable").slice(0, 12))}</p>
      </article>`;
  }).join("");
}

function isOptionHolding(holding) {
  const kind = String(holding.asset_type || holding.type || holding.instrument_type || "").toLowerCase();
  return kind.includes("option") || Boolean(holding.option_symbol);
}

function renderHoldings() {
  const element = document.getElementById("holdingsTable");
  if (!element) return;
  const holdings = safeArray(portfolio.holdings).filter((holding) => !holding.cash_equivalent && !isOptionHolding(holding));
  if (!currentUser || !safeArray(portfolio.accounts).length) {
    element.innerHTML = '<p class="muted">Connect a brokerage account to load live holdings.</p>';
    return;
  }
  if (!holdings.length) {
    element.innerHTML = '<p class="muted">The connected accounts returned no non-option holdings.</p>';
    return;
  }
  element.innerHTML = holdings.map((holding) => `
    <div class="table-row">
      <strong>${escapeHtml(holding.symbol || "Unknown")}</strong>
      <span>${formatNumber(holding.quantity)} units</span>
      <span>Price: ${optionalFiniteNumber(holding.current_price) === null ? "--" : formatCurrency(holding.current_price)}</span>
      <span>Value: ${formatCurrency(holding.market_value)}</span>
      <span>${escapeHtml(holding.account_name || "Investment Account")}</span>
    </div>`).join("");
}

function renderOptions() {
  const options = safeArray(portfolio.holdings).filter((holding) => !holding.cash_equivalent && isOptionHolding(holding));
  setText("optionPositionCount", String(options.length));
  setText("optionsMarketValue", formatCurrency(options.reduce((sum, item) => sum + finiteNumber(item.market_value), 0)));
  const element = document.getElementById("optionsTable");
  if (!element) return;
  if (!currentUser || !safeArray(portfolio.accounts).length) {
    element.innerHTML = '<p class="muted">Connect a brokerage account to load option positions.</p>';
    return;
  }
  if (!options.length) {
    element.innerHTML = '<p class="muted">The connected accounts returned no option positions.</p>';
    return;
  }
  element.innerHTML = options.map((holding) => `
    <div class="table-row">
      <strong>${escapeHtml(holding.symbol || holding.option_symbol || "Option")}</strong>
      <span>${formatNumber(holding.quantity)} contracts</span>
      <span>Price: ${optionalFiniteNumber(holding.current_price) === null ? "--" : formatCurrency(holding.current_price)}</span>
      <span>Value: ${formatCurrency(holding.market_value)}</span>
      <span>${escapeHtml(holding.account_name || "Investment Account")}</span>
    </div>`).join("");
}

async function fetchQuotes() {
  renderQuoteLoading();
  if (!watchlist.length) return;
  try {
    const result = await apiFetchJson(`/api/quotes?symbols=${encodeURIComponent(watchlist.join(","))}`);
    const quoteSource = String(result.source || "").trim();
    if (!quoteSource) {
      throw new Error("The quote API did not identify a live provider");
    }
    quotes = {};
    safeArray(result.data).forEach((quote) => {
      const symbol = normalizeTicker(quote.symbol || quote.ticker);
      if (symbol) quotes[symbol] = quote;
    });
    setText("quoteStatus", `Live (${quoteSource})`);
    setText("lastQuoteUpdate", formatTimestamp(result.data_as_of || new Date().toISOString()));
  } catch (error) {
    quotes = {};
    setText("quoteStatus", "Unavailable");
    setText("lastQuoteUpdate", "No live feed");
    console.warn("Live quotes unavailable:", error);
  }
  renderQuotes();
}

function renderQuoteLoading() {
  setText("quoteStatus", "Loading...");
  renderQuotes();
}

function renderQuotes() {
  const grid = document.getElementById("quoteGrid");
  const table = document.getElementById("watchlistTable");
  const cards = watchlist.map((symbol) => {
    const quote = quotes[symbol];
    const price = optionalFiniteNumber(quote?.price);
    const change = optionalFiniteNumber(quote?.change);
    return `
      <article class="quote-card">
        <strong>${escapeHtml(symbol)}</strong>
        <span>${price === null ? "Live quote unavailable" : formatCurrency(price)}</span>
        <small>${change === null ? "" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}`}</small>
      </article>`;
  }).join("");
  if (grid) grid.innerHTML = cards || '<p class="muted">No symbols in the watchlist.</p>';
  if (table) {
    table.innerHTML = watchlist.map((symbol) => {
      const quote = quotes[symbol];
      const price = optionalFiniteNumber(quote?.price);
      return `
        <div class="table-row">
          <strong>${escapeHtml(symbol)}</strong>
          <span>${price === null ? "Unavailable" : formatCurrency(price)}</span>
          <button type="button" data-remove-symbol="${escapeHtml(symbol)}">Remove</button>
        </div>`;
    }).join("") || '<p class="muted">No symbols in the watchlist.</p>';
    table.querySelectorAll("[data-remove-symbol]").forEach((button) => {
      button.addEventListener("click", () => {
        watchlist = watchlist.filter((symbol) => symbol !== button.dataset.removeSymbol);
        saveStoredJson(STORAGE_KEYS.watchlist, watchlist);
        fetchQuotes();
      });
    });
  }
}

function renderJournal() {
  const element = document.getElementById("journalEntries");
  if (!element) return;
  if (!journalEntries.length) {
    element.innerHTML = '<p class="muted">No journal entries yet.</p>';
    return;
  }
  element.innerHTML = journalEntries.map((entry) => `
    <article class="account-card">
      <h4>${escapeHtml(entry.ticker || "Journal Entry")}</h4>
      <p>${escapeHtml(entry.strategy || "No strategy recorded")}</p>
      <p><strong>${escapeHtml(entry.result || "No result recorded")}</strong></p>
      <p class="muted">${escapeHtml(formatTimestamp(entry.created_at))}</p>
    </article>`).join("");
}

function saveGoal() {
  const input = document.getElementById("goalInput");
  const goal = finiteNumber(input?.value, 0);
  saveStoredJson(STORAGE_KEYS.goal, goal);
  setText("goalStatus", goal > 0 ? `Goal saved: ${formatCurrency(goal)}` : "Goal cleared.");
}

function renderGoal() {
  const goal = loadStoredJson(STORAGE_KEYS.goal, 0);
  const input = document.getElementById("goalInput");
  if (input && goal > 0) input.value = String(goal);
  setText("goalStatus", goal > 0 ? `Current goal: ${formatCurrency(goal)}` : "No goal saved.");
}

async function refreshPrivateData() {
  if (!currentUser) return;
  await Promise.allSettled([checkSnapTradeConfig(), fetchConnections(), fetchPortfolio()]);
}

async function refreshAllData() {
  await Promise.allSettled([checkBackendHealth(), fetchQuotes(), refreshPrivateData()]);
}

async function handleSnapTradeReturn() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get("status");
  if (!status) return;
  window.history.replaceState({}, document.title, `${window.location.origin}${window.location.pathname}`);
  if (status === "SUCCESS") {
    setBrokerageMessage("Brokerage connection completed. Loading account data...");
    await refreshPrivateData();
  } else if (status === "ABANDONED") {
    setBrokerageMessage("Brokerage connection was closed before completion.");
  } else {
    setBrokerageMessage(`Brokerage connection failed: ${params.get("error_code") || "unknown error"}`, true);
  }
}

async function initialize() {
  setupNavigation();
  setupFormsAndButtons();
  renderPortfolio();
  renderAccounts();
  renderConnections();
  renderHoldings();
  renderOptions();
  renderQuotes();
  renderJournal();
  renderGoal();
  await Promise.allSettled([checkBackendHealth(), checkAuth(), fetchQuotes()]);
  if (currentUser) await refreshPrivateData();
  await handleSnapTradeReturn();
  setInterval(fetchQuotes, 60_000);
  setInterval(() => {
    if (currentUser) fetchPortfolio();
  }, 10 * 60_000);
}

document.addEventListener("DOMContentLoaded", () => {
  initialize().catch((error) => {
    console.error("Dashboard initialization failed:", error);
    setBrokerageMessage("Dashboard initialization failed. Check the API deployment.", true);
  });
});
