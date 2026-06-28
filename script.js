const BACKEND_URL = "https://trade-dashboard-api--forrestpbusines.replit.app";

const DEFAULT_WATCHLIST = ["AAPL", "TSLA", "NVDA", "SPY", "QQQ"];

const STORAGE_KEYS = {
  watchlist: "fp_watchlist",
  journal: "fp_trade_journal",
  approvals: "fp_trade_approvals",
  goal: "fp_portfolio_goal"
};

let quotes = {};
let watchlist = loadFromStorage(STORAGE_KEYS.watchlist, DEFAULT_WATCHLIST);
let livePortfolio = null;
let livePortfolioSource = "mock";
let portfolioFetchStatus = "offline";
let portfolioLastSyncAt = null;
let aiCommandCenter = null;
let tradeJournal = loadFromStorage(STORAGE_KEYS.journal, []);
let approvalHistory = loadFromStorage(STORAGE_KEYS.approvals, []);
let currentPendingIndex = 0;
let advancedWatchlistSort = "symbol";
let advancedWatchlistFilter = "";
let brokerConnections = [];
let plaidMessage = "Plaid Link is ready.";
let plaidBusyProvider = null;

const sectorPerformance = [
  { sector: "Technology", change: 1.42, breadth: "Strong" },
  { sector: "Communication", change: 0.84, breadth: "Positive" },
  { sector: "Financials", change: 0.31, breadth: "Mixed" },
  { sector: "Healthcare", change: -0.18, breadth: "Mixed" },
  { sector: "Consumer Discretionary", change: 0.67, breadth: "Positive" },
  { sector: "Energy", change: -0.92, breadth: "Weak" },
  { sector: "Industrials", change: 0.22, breadth: "Mixed" },
  { sector: "Utilities", change: -0.35, breadth: "Defensive" }
];

const marketBreadth = { advancers: 318, decliners: 186, highs: 42, lows: 17 };

const placeholderNews = {
  market: [
    { title: "Index futures steady ahead of Fed speakers", source: "Market desk", time: "Pre-market" },
    { title: "Semiconductors lead early risk appetite", source: "Sector watch", time: "9:45 AM" },
    { title: "Treasury yields hold near weekly range", source: "Rates desk", time: "10:15 AM" }
  ],
  company: [
    { title: "NVDA supplier checks remain in focus", source: "Company feed", time: "Today" },
    { title: "AAPL services growth preview before earnings", source: "Company feed", time: "Today" },
    { title: "TSLA delivery expectations split analysts", source: "Company feed", time: "Today" }
  ],
  watchlist: [
    { title: "SPY volume above 20-day average", source: "Watchlist alert", time: "Live placeholder" },
    { title: "QQQ approaching prior high", source: "Watchlist alert", time: "Live placeholder" },
    { title: "AAPL price alert placeholder armed", source: "Watchlist alert", time: "Live placeholder" }
  ]
};

const economicEvents = [
  { category: "Fed", title: "FOMC speaker window", date: "This week", impact: "High" },
  { category: "CPI", title: "Consumer Price Index", date: "Next release", impact: "High" },
  { category: "Jobs", title: "Nonfarm payrolls", date: "Friday", impact: "High" },
  { category: "Earnings", title: "Mega-cap earnings week", date: "Upcoming", impact: "Medium" }
];

const optionsDashboardData = {
  putCallRatio: 0.86,
  highestIv: { ticker: "TSLA", value: "72% IV" },
  highestVolume: { ticker: "NVDA", value: "124K contracts" },
  unusualActivity: [
    { ticker: "NVDA", contract: "CALL 150", expiry: "Weekly", volume: "42K", note: "Sweep placeholder" },
    { ticker: "TSLA", contract: "PUT 250", expiry: "Monthly", volume: "31K", note: "Hedge placeholder" },
    { ticker: "AAPL", contract: "CALL 230", expiry: "Monthly", volume: "22K", note: "Earnings placeholder" }
  ]
};

const brokers = [
  { id: "robinhood", name: "Robinhood" },
  { id: "sofi", name: "SoFi" },
  { id: "fidelity", name: "Fidelity" },
  { id: "schwab", name: "Charles Schwab" },
  { id: "webull", name: "Webull" }
];

const sampleOptions = [
  {
    ticker: "NVDA",
    type: "CALL",
    strike: 232.5,
    expiration: "2026-06-19",
    contracts: 3,
    avgCost: 0.14,
    current: 0.21
  },
  {
    ticker: "AGQ",
    type: "CALL",
    strike: 125,
    expiration: "2026-06-19",
    contracts: 1,
    avgCost: 0.18,
    current: 0.31
  },
  {
    ticker: "IWM",
    type: "CALL",
    strike: 286,
    expiration: "2026-06-19",
    contracts: 2,
    avgCost: 0.09,
    current: 0.05
  }
];

const pendingTrades = [
  {
    ticker: "NVDA",
    description: "Potential call setup. Watch momentum and volume before entry."
  },
  {
    ticker: "TSLA",
    description: "High-risk trade. Confirm trend direction before entering."
  },
  {
    ticker: "SPY",
    description: "Index play. Better for lower risk compared to single-name options."
  },
  {
    ticker: "AGQ",
    description: "Leveraged silver setup. Position sizing needs to stay small."
  }
];

document.addEventListener("DOMContentLoaded", () => {
  setupNavigation();
  setupForms();
  setupButtons();
  setupProfessionalWorkspaceControls();

  renderAll();

  checkBackendHealth();
  fetchQuotes();
  fetchPortfolio();
  fetchBrokerConnections();
  fetchAiCommandCenter();

  setInterval(fetchQuotes, 30000);
  setInterval(fetchPortfolio, 60000);
  setInterval(fetchAiCommandCenter, 30000);
});

/* STORAGE */

function loadFromStorage(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error("Storage save failed:", error);
  }
}

/* HELPERS */

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setClass(id, className) {
  const el = document.getElementById(id);
  if (el) el.className = className;
}

function formatCurrency(value) {
  const number = Number(value) || 0;

  return number.toLocaleString("en-US", {
    style: "currency",
    currency: "USD"
  });
}

function money(value) {
  return formatCurrency(value);
}

function formatPercent(value) {
  const number = Number(value) || 0;
  return `${number.toFixed(2)}%`;
}

function normalizeTicker(ticker) {
  return String(ticker || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");
}

function getChangeClass(value) {
  return Number(value) >= 0 ? "positive" : "negative";
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

/* NAVIGATION */

function setupNavigation() {
  const navButtons = document.querySelectorAll(".nav-btn");
  const sections = document.querySelectorAll(".page-section");

  navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.section;

      navButtons.forEach((btn) => btn.classList.remove("active"));
      sections.forEach((section) => section.classList.remove("active-section"));

      button.classList.add("active");

      const section = document.getElementById(target);
      if (section) section.classList.add("active-section");
    });
  });
}

/* FORMS */

function setupForms() {
  const addTickerForm = document.getElementById("addTickerForm");
  const tickerInput = document.getElementById("tickerInput");

  if (addTickerForm && tickerInput) {
    addTickerForm.addEventListener("submit", (event) => {
      event.preventDefault();

      const ticker = normalizeTicker(tickerInput.value);
      if (!ticker) return;

      addTickerToWatchlist(ticker);
      tickerInput.value = "";
    });
  }

  const watchlistForm = document.getElementById("watchlistForm");
  const watchlistInput = document.getElementById("watchlistInput");

  if (watchlistForm && watchlistInput) {
    watchlistForm.addEventListener("submit", (event) => {
      event.preventDefault();

      const ticker = normalizeTicker(watchlistInput.value);
      if (!ticker) return;

      addTickerToWatchlist(ticker);
      watchlistInput.value = "";
    });
  }

  const journalForm = document.getElementById("journalForm");

  if (journalForm) {
    journalForm.addEventListener("submit", (event) => {
      event.preventDefault();
      saveJournalEntry();
    });
  }
}

/* BUTTONS */

function setupButtons() {
  const refreshQuotesBtn = document.getElementById("refreshQuotesBtn");

  if (refreshQuotesBtn) {
    refreshQuotesBtn.addEventListener("click", () => {
      fetchQuotes();
      fetchPortfolio();
      fetchAiCommandCenter();
    });
  }

  const refreshPortfolioBtn = document.getElementById("refreshPortfolioBtn");

  if (refreshPortfolioBtn) {
    refreshPortfolioBtn.addEventListener("click", fetchPortfolio);
  }

  const connectPlaidBtn = document.getElementById("connectPlaidBtn");

  if (connectPlaidBtn) {
    connectPlaidBtn.addEventListener("click", () => connectBroker("robinhood"));
  }

  const approveTradeBtn = document.getElementById("approveTradeBtn");

  if (approveTradeBtn) {
    approveTradeBtn.addEventListener("click", () => {
      handleTradeApproval("Approved");
    });
  }

  const rejectTradeBtn = document.getElementById("rejectTradeBtn");

  if (rejectTradeBtn) {
    rejectTradeBtn.addEventListener("click", () => {
      handleTradeApproval("Rejected");
    });
  }

  const saveGoalBtn = document.getElementById("saveGoalBtn");

  if (saveGoalBtn) {
    saveGoalBtn.addEventListener("click", savePortfolioGoal);
  }

  const enableNotificationsBtn = document.getElementById("enableNotificationsBtn");

  if (enableNotificationsBtn) {
    enableNotificationsBtn.addEventListener("click", enableNotifications);
  }

  const testNotificationBtn = document.getElementById("testNotificationBtn");

  if (testNotificationBtn) {
    testNotificationBtn.addEventListener("click", sendTestNotification);
  }
}

/* PROFESSIONAL WORKSPACE CONTROLS */

function setupProfessionalWorkspaceControls() {
  const searchInput = document.getElementById("advancedWatchlistSearch");

  if (searchInput) {
    searchInput.addEventListener("input", (event) => {
      advancedWatchlistFilter = event.target.value || "";
      renderAdvancedWatchlist();
    });
  }

  document.querySelectorAll("[data-watchlist-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      advancedWatchlistSort = button.dataset.watchlistSort || "symbol";
      renderAdvancedWatchlist();
    });
  });
}

/* MAIN RENDER */

function renderAll() {
  renderPortfolioSummary();
  renderQuoteGrid();
  renderWatchlistTable();
  renderAccountsList();
  renderBrokerCards();
  renderPlaidStatus();
  renderHoldingsTable();
  renderOptions();
  renderRiskAnalysis();
  renderPendingTrade();
  renderApprovalHistory();
  renderJournalEntries();
  renderGoal();
  renderAiCommandCenter();
  renderMarketHeatMap();
  renderAdvancedWatchlist();
  renderNewsCenter();
  renderEconomicCalendar();
  renderOptionsDashboard();
}

/* BACKEND */

async function checkBackendHealth() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/quotes?symbols=AAPL`);

    if (!response.ok) {
      throw new Error("Backend health failed");
    }

    setBackendStatus("Live", true);
    setText("backendHealthStatus", "Backend is live.");
  } catch (error) {
    console.warn("Backend health check unavailable:", error);
    setBackendStatus("Offline", false);
    setText("backendHealthStatus", "Backend is offline or blocked.");
  }
}

function setBackendStatus(status, isLive) {
  const backendStatus = document.getElementById("backendStatus");

  if (backendStatus) {
    backendStatus.textContent = status;
    backendStatus.className = isLive ? "positive" : "negative";
  }
}

/* QUOTES */

async function fetchQuotes() {
  if (!watchlist.length) {
    renderQuoteGrid();
    renderWatchlistTable();
    return;
  }

  try {
    setText("quoteStatus", "Loading...");

    const symbols = watchlist.join(",");
    const response = await fetch(`${BACKEND_URL}/api/quotes?symbols=${symbols}`);
    const result = await response.json();

    if (!result.success) {
      throw new Error("Quote response failed");
    }

    const quoteList = result.data || result.quotes || [];

    quotes = {};

    quoteList.forEach((quote) => {
      const symbol = normalizeTicker(quote.symbol || quote.ticker);

      if (symbol) {
        quotes[symbol] = quote;
      }
    });

    setBackendStatus("Live", true);
    setText("quoteStatus", `Live (${result.source || "backend"})`);
    setText("lastQuoteUpdate", new Date().toLocaleTimeString());

    renderQuoteGrid();
    renderWatchlistTable();
    renderAdvancedWatchlist();
    renderHoldingsTable();
  } catch (error) {
    console.warn("Quote fetch unavailable:", error);

    setBackendStatus("Offline", false);
    setText("quoteStatus", "Quotes failed");

    renderQuoteGrid();
    renderWatchlistTable();
    renderAdvancedWatchlist();
  }
}

function getQuotePrice(quote) {
  return Number(
    quote?.price ||
    quote?.last_price ||
    quote?.mark_price ||
    quote?.lastTradePrice ||
    quote?.regularMarketPrice ||
    0
  );
}

function getQuoteChange(quote) {
  return Number(
    quote?.change ||
    quote?.price_change ||
    quote?.regularMarketChange ||
    0
  );
}

function getQuotePercent(quote) {
  return Number(
    quote?.changePercent ||
    quote?.change_percent ||
    quote?.regularMarketChangePercent ||
    0
  );
}

/* PORTFOLIO */

async function fetchPortfolio() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/portfolio`);

    if (!response.ok) {
      throw new Error(`Portfolio request failed with ${response.status}`);
    }

    const result = await response.json();

    if (!result.success || !result.data || typeof result.data !== "object") {
      throw new Error("Portfolio response missing success/data");
    }

    livePortfolio = result.data;
    livePortfolioSource = normalizePortfolioSource(result.source || result.data.source);
    portfolioFetchStatus = livePortfolioSource === "robinhood" ? "live" : "mock";
    portfolioLastSyncAt = new Date();

    setBackendStatus("Live", true);

    renderPortfolioSummary();
    renderAccountsList();
    renderHoldingsTable();
  } catch (error) {
    console.warn("Portfolio fetch unavailable; keeping last data or mock fallback:", error);

    portfolioFetchStatus = "offline";

    if (!livePortfolio) {
      livePortfolioSource = "mock";
    }

    renderPortfolioSummary();
    renderAccountsList();
    renderHoldingsTable();
  }
}

function normalizePortfolioSource(source) {
  const normalized = String(source || "mock").trim().toLowerCase();

  if (normalized === "robinhood") return "robinhood";

  return "mock";
}

function getPortfolioSourceLabel() {
  if (portfolioFetchStatus === "live" && livePortfolioSource === "robinhood") {
    return "robinhood/live";
  }

  if (portfolioFetchStatus === "mock") {
    return "mock/mode";
  }

  return "offline";
}

function getPortfolioConnectionLabel() {
  if (portfolioFetchStatus === "live" && livePortfolioSource === "robinhood") {
    return "Robinhood Connected";
  }

  if (portfolioFetchStatus === "mock") {
    return "Mock Mode";
  }

  return "Offline";
}

function getPortfolioDataSourceLabel() {
  if (portfolioFetchStatus === "live" && livePortfolioSource === "robinhood") {
    return "Live Data Source: Robinhood";
  }

  if (portfolioFetchStatus === "mock") {
    return "Live Data Source: Mock";
  }

  return "Live Data Source: Offline";
}

function getLastSyncLabel() {
  if (!portfolioLastSyncAt) return "Last sync: never";

  return `Last sync: ${portfolioLastSyncAt.toLocaleTimeString()}`;
}

function getPortfolioValue(keyList, fallback = 0, useFallbackWhenLive = false) {
  if (!livePortfolio) return fallback;

  for (const key of keyList) {
    if (livePortfolio[key] !== undefined && livePortfolio[key] !== null) {
      return Number(livePortfolio[key]) || 0;
    }
  }

  return useFallbackWhenLive ? fallback : 0;
}

function getLiveHoldings() {
  if (!livePortfolio) return [];

  return safeArray(
    livePortfolio.holdings ||
    livePortfolio.positions ||
    livePortfolio.securities ||
    livePortfolio.accounts?.[0]?.holdings ||
    livePortfolio.accounts?.[0]?.positions ||
    livePortfolio.account?.holdings ||
    livePortfolio.account?.positions ||
    []
  );
}

function renderPortfolioSummary() {
  const totalValue = getPortfolioValue(
    ["total_value", "totalValue", "total", "balance", "equity", "account_value"],
    52341.87
  );

  const buyingPower = getPortfolioValue(
    ["buying_power", "buyingPower", "available_buying_power"],
    3241.56
  );

  const cash = getPortfolioValue(
    ["cash", "cash_balance", "cashBalance", "cash_available"],
    3241.56
  );

  const investedValue = getPortfolioValue(
    ["invested_value", "investedValue", "market_value", "marketValue"],
    totalValue - cash,
    true
  );

  const dayChange = getPortfolioValue(
    ["day_change", "dailyChange", "dayChange"],
    412.34
  );

  const dayChangePercent = getPortfolioValue(
    ["day_change_percent", "dailyPercent", "dayChangePercent"],
    0.79
  );

  const holdings = getLiveHoldings();

  setText("portfolioValue", formatCurrency(totalValue));
  setText("buyingPower", formatCurrency(buyingPower));
  setText("cash", formatCurrency(cash));
  setText("dailyPL", formatCurrency(dayChange));
  setText("dailyPercent", formatPercent(dayChangePercent));
  setText("openPositions", holdings.length || livePortfolio?.open_positions || 4);
  const accountCount = safeArray(livePortfolio?.accounts).length || (livePortfolio?.account_number ? 1 : 0);

  setText("accountCount", livePortfolioSource === "robinhood" ? `${accountCount || 1} account connected` : "mock fallback");
  setText("portfolioSource", getPortfolioSourceLabel());
  setText("portfolioConnectionStatus", getPortfolioConnectionLabel());
  setText("portfolioLastSync", getLastSyncLabel());
  setText("portfolioDataSource", getPortfolioDataSourceLabel());

  setClass("dailyPL", getChangeClass(dayChange));
  setClass("dailyPercent", getChangeClass(dayChange));

  setText("investedValue", formatCurrency(investedValue));
}

/* PLAID / BROKER CONNECTIONS */

async function apiFetchJson(path, options = {}) {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });

  const result = await response.json().catch(() => null);

  if (!response.ok || !result) {
    throw new Error(result?.error || `Request failed with ${response.status}`);
  }

  return result;
}

function getBrokerConnection(provider) {
  return brokerConnections.find((connection) => connection.provider === provider);
}

function formatConnectionSync(value) {
  if (!value) return "Last Sync: never";

  return `Last Sync: ${new Date(value).toLocaleString()}`;
}

function setPlaidStatus(message, isError = false) {
  plaidMessage = message;

  const statusBox = document.getElementById("plaidStatusMessage");
  if (!statusBox) return;

  statusBox.textContent = message;
  statusBox.className = `plaid-status ${isError ? "negative" : "muted"}`;
}

function renderPlaidStatus() {
  setPlaidStatus(plaidMessage, plaidMessage.toLowerCase().includes("failed") || plaidMessage.toLowerCase().includes("unavailable"));
}

async function fetchBrokerConnections() {
  try {
    const result = await apiFetchJson("/api/broker-connections");

    brokerConnections = safeArray(result.data);
    renderAccountsList();
    renderBrokerCards();
    renderPlaidStatus();
  } catch (error) {
    console.warn("Broker connections unavailable:", error);
    setPlaidStatus("Broker connections are unavailable. Portfolio fallback remains active.", true);
  }
}

async function createBrokerConnection(provider) {
  const result = await apiFetchJson("/api/broker-connections", {
    method: "POST",
    body: JSON.stringify({ provider })
  });

  return result.data;
}

async function createPlaidLinkToken(provider) {
  return apiFetchJson("/api/plaid/create-link-token", {
    method: "POST",
    body: JSON.stringify({ provider })
  });
}

async function exchangePlaidPublicToken(provider, publicToken) {
  return apiFetchJson("/api/plaid/exchange-public-token", {
    method: "POST",
    body: JSON.stringify({ provider, public_token: publicToken })
  });
}

function loadPlaidSdk() {
  if (window.Plaid) return Promise.resolve(true);

  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"]');

    if (existing) {
      existing.addEventListener("load", () => resolve(true), { once: true });
      existing.addEventListener("error", () => reject(new Error("Plaid Link failed to load")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error("Plaid Link failed to load"));
    document.body.appendChild(script);
  });
}

function getPlaidExitMessage(error) {
  const code = error?.error_code || error?.errorCode || "";

  if (code.includes("INVALID_LINK_TOKEN")) {
    return "Plaid Link token expired. Please try connecting again.";
  }

  if (code.includes("INSTITUTION") || code.includes("ITEM_LOGIN_REQUIRED")) {
    return "Plaid institution is unavailable. Please try again later.";
  }

  return "Plaid Link was closed before connecting.";
}

async function handlePlaidSuccess(provider, publicToken) {
  try {
    await exchangePlaidPublicToken(provider, publicToken);
    await fetchBrokerConnections();
    await fetchPortfolio();
    setPlaidStatus("Connected. Portfolio and broker connections refreshed.");
  } catch (error) {
    console.warn("Plaid public token exchange failed:", error);
    setPlaidStatus("Plaid public token exchange failed. Please reconnect.", true);
  } finally {
    plaidBusyProvider = null;
    renderBrokerCards();
  }
}

async function connectWithPlaid(provider) {
  if (plaidBusyProvider) {
    setPlaidStatus("Plaid Link is already opening. Please finish or close the current session.");
    return;
  }

  plaidBusyProvider = provider;
  setPlaidStatus("Requesting Plaid Link token...");
  renderBrokerCards();

  try {
    const tokenResponse = await createPlaidLinkToken(provider);

    if (!tokenResponse.configured || !tokenResponse.link_token) {
      setPlaidStatus(tokenResponse.message || "Plaid is not configured. Creating a demo broker connection.");
      await createBrokerConnection(provider);
      await fetchBrokerConnections();
      await fetchPortfolio();
      plaidBusyProvider = null;
      setPlaidStatus("Demo broker connection created. Portfolio refreshed.");
      renderBrokerCards();
      return;
    }

    await loadPlaidSdk();

    if (!window.Plaid) {
      throw new Error("Plaid Link SDK unavailable");
    }

    const handler = window.Plaid.create({
      token: tokenResponse.link_token,
      onSuccess: (publicToken) => handlePlaidSuccess(provider, publicToken),
      onExit: (error) => {
        plaidBusyProvider = null;
        setPlaidStatus(getPlaidExitMessage(error), Boolean(error));
        renderBrokerCards();
      }
    });

    handler.open();
  } catch (error) {
    console.warn("Plaid connection failed:", error);
    plaidBusyProvider = null;
    setPlaidStatus("Plaid backend or Link SDK is unavailable. Please try again later.", true);
    renderBrokerCards();
  }
}

/* ACCOUNTS */

function renderAccountsList() {
  const accountsList = document.getElementById("accountsList");

  if (!accountsList) return;

  if (brokerConnections.length) {
    const connected = brokerConnections.filter((connection) => connection.status === "connected");
    const totalBalance = connected.reduce((sum, connection) => sum + Number(connection.balance || 0), 0);
    const totalBuyingPower = connected.reduce((sum, connection) => sum + Number(connection.buying_power || 0), 0);

    accountsList.innerHTML = `
      <article class="account-card">
        <h4>Connected Accounts</h4>
        <span class="status-pill status-connected">Connected</span>
        <p>Account Count: <strong>${connected.length}</strong></p>
        <p>Balance: <strong>${formatCurrency(totalBalance)}</strong></p>
        <p>Buying Power: <strong>${formatCurrency(totalBuyingPower)}</strong></p>
      </article>
      ${brokerConnections.map((connection) => {
        return `
          <article class="account-card">
            <h4>${connection.name}</h4>
            <span class="status-pill ${connection.status === "connected" ? "status-connected" : "status-coming"}">
              ${connection.status === "connected" ? "Connected" : connection.status}
            </span>
            <p>Institution Name: <strong>${connection.name}</strong></p>
            <p>Account Count: <strong>1</strong></p>
            <p>${formatConnectionSync(connection.last_connected)}</p>
            <p>Balance: <strong>${formatCurrency(connection.balance)}</strong></p>
            <p>Buying Power: <strong>${formatCurrency(connection.buying_power)}</strong></p>
          </article>
        `;
      }).join("")}
    `;

    return;
  }

  if (livePortfolio) {
    const accountName = livePortfolio.account_name || livePortfolio.broker || (livePortfolioSource === "robinhood" ? "Robinhood" : "Mock Portfolio");
    const totalValue = getPortfolioValue(["total_value", "totalValue", "total", "balance", "equity", "account_value"]);
    const buyingPower = getPortfolioValue(["buying_power", "buyingPower", "available_buying_power"]);
    const cash = getPortfolioValue(["cash", "cash_balance", "cashBalance", "cash_available"]);

    accountsList.innerHTML = `
      <article class="account-card">
        <h4>${accountName}</h4>

        <span class="status-pill ${portfolioFetchStatus === "live" && livePortfolioSource === "robinhood" ? "status-connected" : "status-coming"}">
          ${portfolioFetchStatus === "live" && livePortfolioSource === "robinhood" ? "Connected" : getPortfolioConnectionLabel()}
        </span>

        <p>Institution Name: <strong>${accountName}</strong></p>
        <p>Account Count: <strong>${livePortfolio?.account_number ? 1 : 0}</strong></p>
        <p>Balance: <strong>${formatCurrency(totalValue)}</strong></p>
        <p>Buying Power: <strong>${formatCurrency(buyingPower)}</strong></p>
        <p>Cash: <strong>${formatCurrency(cash)}</strong></p>
      </article>
    `;

    return;
  }

  accountsList.innerHTML = brokers.map((broker) => {
    return `
      <article class="account-card">
        <h4>${broker.name}</h4>

        <span class="status-pill status-disconnected">
          Not Connected
        </span>

        <p>Institution Name: <strong>${broker.name}</strong></p>
        <p>Account Count: <strong>0</strong></p>
        <p>Balance: <strong>$0.00</strong></p>
        <p>Buying Power: <strong>$0.00</strong></p>
      </article>
    `;
  }).join("");
}

function renderBrokerCards() {
  const brokerCards = document.getElementById("brokerCards");

  if (!brokerCards) return;

  brokerCards.innerHTML = brokers.map((broker) => {
    const connection = getBrokerConnection(broker.id);
    const connected =
      connection?.status === "connected" ||
      (portfolioFetchStatus === "live" && livePortfolioSource === "robinhood" && broker.id === "robinhood");
    const isBusy = plaidBusyProvider === broker.id;

    return `
      <article class="broker-card">
        <h4>${connection?.name || broker.name}</h4>

        <span class="status-pill ${connected ? "status-connected" : isBusy ? "status-coming" : "status-coming"}">
          ${connected ? "Connected" : isBusy ? "Connecting..." : "Plaid Ready"}
        </span>

        <p>Institution Name: <strong>${connection?.name || broker.name}</strong></p>
        <p>Account Count: <strong>${connection ? 1 : 0}</strong></p>
        <p class="muted">${formatConnectionSync(connection?.last_connected)}</p>
        <p class="muted">
          Secure account linking runs through Plaid Link.
        </p>

        <button onclick="connectBroker('${broker.id}')" ${isBusy ? "disabled" : ""}>
          ${connected ? "Sync Account" : isBusy ? "Connecting..." : "Connect"}
        </button>
      </article>
    `;
  }).join("");
}

function connectBroker(accountId) {
  const broker = brokers.find((item) => item.id === accountId);

  if (!broker) return;

  if (getBrokerConnection(broker.id)?.status === "connected") {
    fetchBrokerConnections();
  if (broker.id === "robinhood" && portfolioFetchStatus === "live" && livePortfolioSource === "robinhood") {
    fetchPortfolio();
    setPlaidStatus(`${broker.name} account sync requested.`);
    return;
  }

  if (broker.id === "robinhood" && portfolioFetchStatus === "live" && livePortfolioSource === "robinhood") {
    fetchPortfolio();
    setPlaidStatus("Robinhood sync started.");
    return;
  }

  connectWithPlaid(broker.id);
}

/* HOLDINGS */

function firstFiniteNumber(values, fallback = 0) {
  for (const value of values) {
    const number = Number(value);

    if (Number.isFinite(number)) return number;
  }

  return fallback;
}

function normalizeHoldingRow(holding) {
  if (!holding || typeof holding !== "object") return null;

  const symbol = normalizeTicker(
    holding.symbol ||
    holding.ticker ||
    holding.instrument ||
    holding.name
  );

  const quantity = firstFiniteNumber([
    holding.quantity,
    holding.shares,
    holding.qty,
    holding.units
  ]);

  if (!symbol || quantity <= 0) return null;

  const quote = quotes[symbol] || {};
  const currentPrice = firstFiniteNumber([
    holding.current_price,
    holding.currentPrice,
    holding.price,
    holding.last_price,
    holding.market_price,
    getQuotePrice(quote)
  ]);

  const marketValue = firstFiniteNumber([
    holding.market_value,
    holding.marketValue,
    holding.value,
    holding.equity,
    currentPrice ? quantity * currentPrice : undefined
  ]);

  if (marketValue <= 0 && currentPrice <= 0) return null;

  const avgCost = firstFiniteNumber([
    holding.average_cost,
    holding.avg_cost,
    holding.averageCost,
    holding.average_buy_price,
    holding.cost_basis_per_share
  ]);

  const todaysChange = firstFiniteNumber([
    holding.day_change,
    holding.dayChange,
    holding.today_change,
    holding.todayChange,
    holding.change,
    holding.price_change
  ]);

  const explicitTotalGainLoss = firstFiniteNumber([
    holding.total_gain_loss,
    holding.totalGainLoss,
    holding.unrealized_pl,
    holding.unrealizedPL,
    holding.gain_loss,
    holding.gainLoss
  ], NaN);

  const totalCost = quantity * avgCost;
  const totalGainLoss = Number.isFinite(explicitTotalGainLoss)
    ? explicitTotalGainLoss
    : totalCost
      ? marketValue - totalCost
      : 0;

  const totalGainLossPercent = totalCost ? (totalGainLoss / totalCost) * 100 : 0;

  return {
    symbol,
    quantity,
    currentPrice,
    marketValue,
    todaysChange,
    totalGainLoss,
    totalGainLossPercent
  };
}

function renderHoldingsTable() {
  const holdingsTable = document.getElementById("holdingsTable");

  if (!holdingsTable) return;

  const holdings = getLiveHoldings();

  if (!livePortfolio) {
    holdingsTable.innerHTML = `
      <p class="muted">
        Portfolio is loading. If this stays here, the backend portfolio endpoint is offline.
      </p>
    `;
    return;
  }

  if (!holdings.length) {
    holdingsTable.innerHTML = `
      <p class="muted">
        Portfolio totals are live, but holdings are not being sent from the backend yet.
        Next step is updating Replit /api/portfolio so it includes positions.
      </p>
    `;
    return;
  }

  const rows = holdings
    .map(normalizeHoldingRow)
    .filter(Boolean);

  if (!rows.length) {
    holdingsTable.innerHTML = `
      <p class="muted">
        Holdings were received, but none had enough valid data to display.
      </p>
    `;
    return;
  }

  holdingsTable.innerHTML = rows.map((holding) => {
    return `
      <div class="table-row">
        <strong>${holding.symbol}</strong>
        <span>${holding.quantity.toLocaleString()} shares</span>
        <span>Current: ${holding.currentPrice ? formatCurrency(holding.currentPrice) : "--"}</span>
        <span>Value: ${formatCurrency(holding.marketValue)}</span>
        <span class="${getChangeClass(holding.todaysChange)}">
          Today: ${formatCurrency(holding.todaysChange)}
        </span>
        <span class="${getChangeClass(holding.totalGainLoss)}">
          Total: ${formatCurrency(holding.totalGainLoss)} / ${formatPercent(holding.totalGainLossPercent)}
        </span>
      </div>
    `;
  }).join("");
}

/* WATCHLIST */

function addTickerToWatchlist(ticker) {
  if (watchlist.includes(ticker)) return;

  watchlist.push(ticker);
  saveToStorage(STORAGE_KEYS.watchlist, watchlist);

  renderQuoteGrid();
  renderWatchlistTable();
  fetchQuotes();
}

function removeTickerFromWatchlist(ticker) {
  watchlist = watchlist.filter((item) => item !== ticker);
  delete quotes[ticker];

  saveToStorage(STORAGE_KEYS.watchlist, watchlist);

  renderQuoteGrid();
  renderWatchlistTable();
  fetchQuotes();
}

function renderQuoteGrid() {
  const quoteGrid = document.getElementById("quoteGrid");

  if (!quoteGrid) return;

  if (!watchlist.length) {
    quoteGrid.innerHTML = `<p class="muted">No tickers yet.</p>`;
    return;
  }

  quoteGrid.innerHTML = watchlist.map((ticker) => {
    const quote = quotes[ticker] || {};
    const price = getQuotePrice(quote);
    const change = getQuoteChange(quote);
    const percent = getQuotePercent(quote);

    return `
      <article class="quote-card">
        <div class="quote-card-header">
          <h4>${ticker}</h4>
          <button onclick="removeTickerFromWatchlist('${ticker}')">Remove</button>
        </div>

        <div class="quote-price">
          ${price ? formatCurrency(price) : "Loading..."}
        </div>

        <div class="quote-change ${getChangeClass(change)}">
          ${formatCurrency(change)} / ${formatPercent(percent)}
        </div>

        <small class="muted">
          Source: ${quote.source || "Backend"}
        </small>
      </article>
    `;
  }).join("");
}

function renderWatchlistTable() {
  const watchlistTable = document.getElementById("watchlistTable");

  if (!watchlistTable) return;

  if (!watchlist.length) {
    watchlistTable.innerHTML = `<p class="muted">Your watchlist is empty.</p>`;
    return;
  }

  watchlistTable.innerHTML = watchlist.map((ticker) => {
    const quote = quotes[ticker] || {};
    const price = getQuotePrice(quote);
    const change = getQuoteChange(quote);
    const percent = getQuotePercent(quote);

    return `
      <div class="table-row">
        <strong>${ticker}</strong>
        <span>${price ? formatCurrency(price) : "Loading..."}</span>
        <span class="${getChangeClass(change)}">
          ${formatCurrency(change)} / ${formatPercent(percent)}
        </span>
        <button onclick="removeTickerFromWatchlist('${ticker}')">Remove</button>
      </div>
    `;
  }).join("");
}

/* PROFESSIONAL WORKSPACE */

function formatCompactNumber(value) {
  const number = Number(value) || 0;

  if (number >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(1)}B`;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)}K`;

  return number.toLocaleString();
}

function renderMarketHeatMap() {
  const heatMap = document.getElementById("marketHeatMap");

  if (heatMap) {
    heatMap.innerHTML = sectorPerformance.map((item) => {
      return `
        <article class="heat-map-tile ${getChangeClass(item.change)}">
          <strong>${item.sector}</strong>
          <span>${formatPercent(item.change)}</span>
          <small>${item.breadth} breadth</small>
        </article>
      `;
    }).join("");
  }

  setText("marketAdvancers", marketBreadth.advancers);
  setText("marketDecliners", marketBreadth.decliners);
  setText("marketHighs", marketBreadth.highs);
  setText("marketLows", marketBreadth.lows);
}

function getAdvancedWatchlistRows() {
  const filter = advancedWatchlistFilter.trim().toUpperCase();

  return watchlist
    .filter((ticker) => !filter || ticker.includes(filter))
    .map((ticker) => {
      const quote = quotes[ticker] || {};
      const price = getQuotePrice(quote);
      const percent = getQuotePercent(quote);
      const volume = Number(quote.volume || quote.regularMarketVolume || 0);
      const marketCap = Number(quote.marketCap || quote.market_cap || 0);

      return { ticker, price, percent, volume, marketCap };
    })
    .sort((a, b) => {
      if (advancedWatchlistSort === "symbol") return a.ticker.localeCompare(b.ticker);
      return Number(b[advancedWatchlistSort] || 0) - Number(a[advancedWatchlistSort] || 0);
    });
}

function renderAdvancedWatchlist() {
  const table = document.getElementById("advancedWatchlistTable");

  if (!table) return;

  const rows = getAdvancedWatchlistRows();

  if (!rows.length) {
    table.innerHTML = `<p class="muted">No symbols match the current watchlist filter.</p>`;
    return;
  }

  table.innerHTML = rows.map((row) => {
    return `
      <div class="workspace-table-row advanced-watchlist-row">
        <strong>${row.ticker}</strong>
        <span>${row.price ? formatCurrency(row.price) : "Loading..."}</span>
        <span class="${getChangeClass(row.percent)}">${formatPercent(row.percent)}</span>
        <span>${row.volume ? formatCompactNumber(row.volume) : "API ready"}</span>
        <span>${row.marketCap ? formatCompactNumber(row.marketCap) : "API ready"}</span>
        <span title="Alert rules coming with live backend">🔔</span>
      </div>
    `;
  }).join("");
}

function renderNewsList(id, items) {
  const feed = document.getElementById(id);

  if (!feed) return;

  if (!items.length) {
    feed.innerHTML = `<p class="muted">No news available. API integration placeholder.</p>`;
    return;
  }

  feed.innerHTML = items.map((item) => {
    return `
      <article class="news-item">
        <strong>${item.title}</strong>
        <small>${item.source} · ${item.time}</small>
      </article>
    `;
  }).join("");
}

function renderNewsCenter() {
  renderNewsList("marketNewsFeed", placeholderNews.market);
  renderNewsList("companyNewsFeed", placeholderNews.company);
  renderNewsList("watchlistNewsFeed", placeholderNews.watchlist);
}

function renderEconomicCalendar() {
  const calendar = document.getElementById("economicCalendarList");

  if (!calendar) return;

  calendar.innerHTML = economicEvents.map((event) => {
    return `
      <article class="timeline-item">
        <span>${event.category}</span>
        <strong>${event.title}</strong>
        <small>${event.date} · ${event.impact} impact</small>
      </article>
    `;
  }).join("");
}

function renderOptionsDashboard() {
  setText("putCallRatio", optionsDashboardData.putCallRatio.toFixed(2));
  setText("highestIvTicker", optionsDashboardData.highestIv.ticker);
  setText("highestIvValue", optionsDashboardData.highestIv.value);
  setText("highestOptionVolumeTicker", optionsDashboardData.highestVolume.ticker);
  setText("highestOptionVolumeValue", optionsDashboardData.highestVolume.value);

  const table = document.getElementById("unusualOptionsTable");

  if (!table) return;

  table.innerHTML = optionsDashboardData.unusualActivity.map((item) => {
    return `
      <div class="workspace-table-row unusual-options-row">
        <strong>${item.ticker}</strong>
        <span>${item.contract}</span>
        <span>${item.expiry}</span>
        <span>${item.volume}</span>
        <span>${item.note}</span>
      </div>
    `;
  }).join("");
}

/* OPTIONS */

function renderOptions() {
  const totalPL = sampleOptions.reduce((sum, option) => {
    return sum + getOptionPL(option);
  }, 0);

  const winners = sampleOptions.filter((option) => getOptionPL(option) > 0).length;
  const winRate = sampleOptions.length ? (winners / sampleOptions.length) * 100 : 0;

  setText("optionContracts", getTotalContracts());
  setText("optionsPL", formatCurrency(totalPL));
  setText("optionWinRate", `${winRate.toFixed(0)}%`);
  setText("riskScore", calculateRiskScore());

  const openOptionsTable = document.getElementById("openOptionsTable");

  if (!openOptionsTable) return;

  openOptionsTable.innerHTML = sampleOptions.map((option) => {
    const pl = getOptionPL(option);

    return `
      <div class="table-row">
        <strong>${option.ticker} ${option.type}</strong>
        <span>$${option.strike} / ${option.expiration}</span>
        <span>${option.contracts} contracts</span>
        <span class="${getChangeClass(pl)}">${formatCurrency(pl)}</span>
      </div>
    `;
  }).join("");
}

function getOptionPL(option) {
  return (
    (Number(option.current) - Number(option.avgCost)) *
    Number(option.contracts) *
    100
  );
}

function getTotalContracts() {
  return sampleOptions.reduce((sum, option) => {
    return sum + Number(option.contracts || 0);
  }, 0);
}

function calculateRiskScore() {
  const contracts = getTotalContracts();

  if (contracts >= 10) return 85;
  if (contracts >= 5) return 62;

  return 38;
}

function renderRiskAnalysis() {
  const riskAnalysisBox = document.getElementById("riskAnalysisBox");

  if (!riskAnalysisBox) return;

  const score = calculateRiskScore();

  let message = "Risk is controlled. Position sizing is reasonable.";

  if (score >= 80) {
    message = "Risk is high. Reduce contract count or avoid overconcentration.";
  } else if (score >= 60) {
    message = "Risk is moderate. Keep position sizing tight and avoid chasing.";
  }

  riskAnalysisBox.innerHTML = `
    <p><strong>Current Risk Score:</strong> ${score}</p>
    <p>${message}</p>
    <p class="muted">
      Placeholder logic for now. Later this will use Greeks, expiration,
      account size, and max-loss rules.
    </p>
  `;
}

/* APPROVALS */

function renderPendingTrade() {
  const trade = pendingTrades[currentPendingIndex];

  if (!trade) return;

  setText("approvalTicker", trade.ticker);
  setText("approvalDescription", trade.description);
}

function handleTradeApproval(status) {
  const trade = pendingTrades[currentPendingIndex];

  if (!trade) return;

  approvalHistory.unshift({
    ticker: trade.ticker,
    description: trade.description,
    status,
    date: new Date().toLocaleString()
  });

  saveToStorage(STORAGE_KEYS.approvals, approvalHistory);

  currentPendingIndex = (currentPendingIndex + 1) % pendingTrades.length;

  renderPendingTrade();
  renderApprovalHistory();
}

function renderApprovalHistory() {
  const approvalHistoryBox = document.getElementById("approvalHistory");

  if (!approvalHistoryBox) return;

  if (!approvalHistory.length) {
    approvalHistoryBox.innerHTML = `<p class="muted">No approval history yet.</p>`;
    return;
  }

  approvalHistoryBox.innerHTML = approvalHistory.slice(0, 8).map((item) => {
    const itemClass = item.status === "Approved" ? "positive" : "negative";

    return `
      <div class="approval-item">
        <strong>${item.ticker}</strong>
        <p>${item.description}</p>
        <p class="${itemClass}">${item.status}</p>
        <small class="muted">${item.date}</small>
      </div>
    `;
  }).join("");
}

/* JOURNAL */

function saveJournalEntry() {
  const tickerInput = document.getElementById("journalTicker");
  const strategyInput = document.getElementById("journalStrategy");
  const resultInput = document.getElementById("journalResult");

  if (!tickerInput || !strategyInput || !resultInput) return;

  const ticker = normalizeTicker(tickerInput.value);
  const strategy = strategyInput.value.trim();
  const result = resultInput.value.trim();

  if (!ticker || !strategy || !result) {
    alert("Fill out ticker, strategy, and result first.");
    return;
  }

  tradeJournal.unshift({
    id: Date.now(),
    ticker,
    strategy,
    result,
    date: new Date().toLocaleString()
  });

  saveToStorage(STORAGE_KEYS.journal, tradeJournal);

  tickerInput.value = "";
  strategyInput.value = "";
  resultInput.value = "";

  renderJournalEntries();
}

function renderJournalEntries() {
  const journalEntries = document.getElementById("journalEntries");

  if (!journalEntries) return;

  if (!tradeJournal.length) {
    journalEntries.innerHTML = `<p class="muted">No journal entries yet.</p>`;
    return;
  }

  journalEntries.innerHTML = tradeJournal.map((entry) => {
    return `
      <article class="journal-entry">
        <h4>${entry.ticker}</h4>
        <p><strong>Strategy:</strong> ${entry.strategy}</p>
        <p><strong>Result:</strong> ${entry.result}</p>
        <small class="muted">${entry.date}</small>
        <br />
        <button onclick="deleteJournalEntry(${entry.id})">Delete</button>
      </article>
    `;
  }).join("");
}

function deleteJournalEntry(id) {
  tradeJournal = tradeJournal.filter((entry) => entry.id !== id);
  saveToStorage(STORAGE_KEYS.journal, tradeJournal);
  renderJournalEntries();
}

/* SETTINGS */

function savePortfolioGoal() {
  const goalInput = document.getElementById("goalInput");

  if (!goalInput) return;

  const goal = Number(goalInput.value);

  if (!goal) {
    alert("Enter a portfolio goal first.");
    return;
  }

  saveToStorage(STORAGE_KEYS.goal, goal);
  alert(`Portfolio goal saved: ${formatCurrency(goal)}`);
}

function renderGoal() {
  const goalInput = document.getElementById("goalInput");

  if (!goalInput) return;

  const savedGoal = loadFromStorage(STORAGE_KEYS.goal, "");
  goalInput.value = savedGoal || "";
}

/* NOTIFICATIONS */

function enableNotifications() {
  if (!("Notification" in window)) {
    alert("This browser does not support notifications.");
    return;
  }

  Notification.requestPermission().then((permission) => {
    if (permission === "granted") {
      alert("Notifications enabled.");
    } else {
      alert("Notifications were not enabled.");
    }
  });
}

function sendTestNotification() {
  if (!("Notification" in window)) {
    alert("Test alert is working.");
    return;
  }

  if (Notification.permission === "granted") {
    new Notification("Trading Dashboard Alert", {
      body: "Test alert is working."
    });
  } else {
    alert("Enable notifications first.");
  }
}

/* AI COMMAND CENTER */

async function fetchAiCommandCenter() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/ai/command-center`);
    const result = await response.json();

    if (!result.success || !result.data) {
      throw new Error("AI command center failed");
    }

    aiCommandCenter = result.data;
    renderAiCommandCenter();
  } catch (error) {
    console.warn("AI command center unavailable:", error);
    aiCommandCenter = null;
    renderAiCommandCenter();
  }
}

function renderAiCommandCenter() {
  const summaryBox = document.getElementById("aiCommandSummary");
  const alertsBox = document.getElementById("aiCommandAlerts");

  if (!summaryBox || !alertsBox) return;

  if (!aiCommandCenter) {
    setText("aiConfidenceScore", "--");
    setText("aiMarketBias", "Offline");

    summaryBox.textContent = "AI Command Center is unavailable.";

    alertsBox.innerHTML = `<p class="muted">No AI alerts available.</p>`;
    return;
  }

  setText("aiConfidenceScore", `${aiCommandCenter.confidence_score}%`);
  setText("aiMarketBias", aiCommandCenter.market_bias || "Neutral");

  summaryBox.textContent = aiCommandCenter.summary || "AI monitoring active.";

  const alerts = aiCommandCenter.alerts || [];

  if (!alerts.length) {
    alertsBox.innerHTML = `<p class="muted">No AI alerts available.</p>`;
    return;
  }

  alertsBox.innerHTML = alerts.map((alert, index) => {
    const isOption = alert.type === "CALL" || alert.type === "PUT";

    const title = isOption
      ? `${alert.ticker} ${alert.type} $${alert.strike}`
      : `${alert.ticker} ${alert.category}`;

    return `
      <article class="approval-item">
        <strong>${title}</strong>
        <p>Category: ${alert.category}</p>
        <p>Confidence: <strong>${alert.confidence}%</strong></p>
        <p>Risk: <strong>${alert.risk}</strong></p>
        <p class="muted">${alert.reason}</p>
        <button onclick="addCommandAlertToApprovalQueue(${index})">
          Add to Approval Queue
        </button>
      </article>
    `;
  }).join("");
}

function addCommandAlertToApprovalQueue(index) {
  if (!aiCommandCenter || !aiCommandCenter.alerts) return;

  const alert = aiCommandCenter.alerts[index];

  if (!alert) return;

  const isOption = alert.type === "CALL" || alert.type === "PUT";

  const tradeDescription = isOption
    ? `${alert.type} $${alert.strike} exp ${alert.expiration}. ${alert.reason}`
    : `${alert.category}. ${alert.reason}`;

  pendingTrades.unshift({
    ticker: alert.ticker,
    description: tradeDescription
  });

  currentPendingIndex = 0;
  renderPendingTrade();

  alert(`${alert.ticker} added to approval queue.`);
}



