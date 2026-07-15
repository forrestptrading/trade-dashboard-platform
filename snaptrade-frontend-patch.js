/* SnapTrade Personal integration appended after the legacy dashboard script. */
let snapTradeUser = null;
let snapTradeAuthBusy = false;
let snapTradeConnectBusy = false;

function snapTradeStatus(message, isError = false) {
  plaidMessage = message;
  const box = document.getElementById("plaidStatusMessage");
  if (!box) return;
  box.textContent = message;
  box.className = `plaid-status ${isError ? "negative" : "muted"}`;
}

function setPlaidStatus(message, isError = false) {
  snapTradeStatus(message, isError);
}

function renderPlaidStatus() {
  const value = String(plaidMessage || "").toLowerCase();
  snapTradeStatus(
    plaidMessage,
    value.includes("failed") ||
      value.includes("error") ||
      value.includes("unavailable") ||
      value.includes("required")
  );
}

function installSnapTradeUi() {
  const accountsSection = document.getElementById("accounts");
  const oldButton = document.getElementById("connectPlaidBtn");

  if (oldButton && !oldButton.dataset.snaptradeBound) {
    const button = oldButton.cloneNode(true);
    button.id = "connectPlaidBtn";
    button.textContent = "Connect Brokerage";
    button.dataset.snaptradeBound = "true";
    button.addEventListener("click", connectWithSnapTrade);
    oldButton.replaceWith(button);
  }

  const mainPanel = accountsSection?.querySelector(".panel");
  if (mainPanel) {
    const heading = mainPanel.querySelector("h3");
    const description = mainPanel.querySelector(".panel-header p");
    if (heading) heading.textContent = "Connected Investment Accounts";
    if (description) {
      description.textContent =
        "Secure brokerage connections and portfolio balances through SnapTrade.";
    }
  }

  if (!accountsSection || document.getElementById("snapTradeAuthPanel")) return;

  const panel = document.createElement("section");
  panel.id = "snapTradeAuthPanel";
  panel.className = "panel";
  panel.innerHTML = `
    <div class="panel-header">
      <div>
        <h3>Dashboard Sign In</h3>
        <p>Sign in before loading private investment account data.</p>
      </div>
      <span id="snapTradeAuthStatus" class="status-pill status-coming">Checking</span>
    </div>
    <form id="snapTradeAuthForm" class="journal-form">
      <input id="snapTradeEmail" type="email" autocomplete="email" placeholder="Email" required />
      <input id="snapTradePassword" type="password" autocomplete="current-password" placeholder="Password" minlength="8" required />
      <button id="snapTradeLoginBtn" type="submit">Sign In</button>
      <button id="snapTradeRegisterBtn" type="button">Create Account</button>
      <button id="snapTradeLogoutBtn" type="button" hidden>Sign Out</button>
    </form>
    <p id="snapTradeAuthMessage" class="muted">Checking your dashboard session...</p>
  `;
  accountsSection.insertBefore(panel, accountsSection.firstChild);

  document.getElementById("snapTradeAuthForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitSnapTradeAuth("login");
  });
  document.getElementById("snapTradeRegisterBtn")?.addEventListener("click", () => {
    submitSnapTradeAuth("register");
  });
  document.getElementById("snapTradeLogoutBtn")?.addEventListener(
    "click",
    logoutSnapTrade
  );
}

function renderSnapTradeAuth() {
  const signedIn = Boolean(snapTradeUser);
  const status = document.getElementById("snapTradeAuthStatus");
  const message = document.getElementById("snapTradeAuthMessage");
  const email = document.getElementById("snapTradeEmail");
  const password = document.getElementById("snapTradePassword");
  const login = document.getElementById("snapTradeLoginBtn");
  const register = document.getElementById("snapTradeRegisterBtn");
  const logout = document.getElementById("snapTradeLogoutBtn");
  const connect = document.getElementById("connectPlaidBtn");

  if (status) {
    status.textContent = signedIn
      ? "Signed In"
      : snapTradeAuthBusy
        ? "Working"
        : "Signed Out";
    status.className = `status-pill ${signedIn ? "status-connected" : "status-coming"}`;
  }
  if (message) {
    message.textContent = signedIn
      ? `Signed in as ${snapTradeUser.email}.`
      : "Use the dashboard owner email configured in Replit.";
  }
  if (email) email.hidden = signedIn;
  if (password) password.hidden = signedIn;
  if (login) login.hidden = signedIn;
  if (register) register.hidden = signedIn;
  if (logout) logout.hidden = !signedIn;
  if (connect) connect.disabled = !signedIn || snapTradeConnectBusy;
}

async function checkSnapTradeAuth() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/me`, {
      credentials: "include"
    });
    const result = await response.json().catch(() => null);
    snapTradeUser = response.ok && result?.success
      ? result.data?.user || null
      : null;
  } catch (error) {
    console.warn("Dashboard session check failed:", error);
    snapTradeUser = null;
  }
  renderSnapTradeAuth();
}

async function submitSnapTradeAuth(mode) {
  if (snapTradeAuthBusy) return;
  const email = document.getElementById("snapTradeEmail")?.value?.trim();
  const password = document.getElementById("snapTradePassword")?.value || "";
  const message = document.getElementById("snapTradeAuthMessage");

  if (!email || password.length < 8) {
    if (message) {
      message.textContent =
        "Enter the owner email and a password of at least 8 characters.";
    }
    return;
  }

  snapTradeAuthBusy = true;
  renderSnapTradeAuth();
  try {
    const result = await apiFetchJson(`/api/auth/${mode}`, {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    snapTradeUser = result.data?.user || null;
    snapTradeStatus("Signed in. SnapTrade brokerage linking is ready.");
    await Promise.allSettled([
      fetchBrokerConnections(),
      fetchPortfolio(),
      fetchAggregatePortfolio()
    ]);
  } catch (error) {
    console.warn(`Dashboard ${mode} failed:`, error);
    if (message) message.textContent = error.message || `Dashboard ${mode} failed.`;
  } finally {
    snapTradeAuthBusy = false;
    renderSnapTradeAuth();
  }
}

async function logoutSnapTrade() {
  try {
    await apiFetchJson("/api/auth/logout", {
      method: "POST",
      body: JSON.stringify({})
    });
  } catch (error) {
    console.warn("Dashboard logout failed:", error);
  }
  snapTradeUser = null;
  brokerConnections = [];
  livePortfolio = null;
  livePortfolioSource = "mock";
  snapTradeStatus("Signed out. Private brokerage data is hidden.");
  renderSnapTradeAuth();
  renderAccountsList();
  renderBrokerCards();
}

async function connectWithSnapTrade() {
  if (!snapTradeUser) {
    snapTradeStatus("Dashboard sign-in is required before connecting a brokerage.", true);
    return;
  }
  if (snapTradeConnectBusy) return;

  snapTradeConnectBusy = true;
  snapTradeStatus("Opening the SnapTrade brokerage connection portal...");
  renderSnapTradeAuth();
  renderBrokerCards();
  try {
    const result = await apiFetchJson("/api/snaptrade/connect", {
      method: "POST",
      body: JSON.stringify({})
    });
    if (!result.redirect_uri) {
      throw new Error("SnapTrade did not return a connection link");
    }
    window.location.assign(result.redirect_uri);
  } catch (error) {
    console.warn("SnapTrade connection failed:", error);
    snapTradeConnectBusy = false;
    snapTradeStatus(error.message || "SnapTrade connection failed.", true);
    renderSnapTradeAuth();
    renderBrokerCards();
  }
}

function normalizeSnapTradeConnection(connection) {
  const brokerage = connection?.brokerage || {};
  const name = brokerage.name || connection?.name || "Brokerage";
  const provider = String(brokerage.slug || connection?.slug || name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return {
    id: connection?.id || connection?.authorization_id || provider,
    provider,
    name,
    status: connection?.disabled ? "disabled" : "connected",
    last_connected:
      connection?.updated_date ||
      connection?.last_sync ||
      connection?.created_date ||
      null
  };
}

async function fetchBrokerConnections() {
  if (!snapTradeUser) {
    brokerConnections = [];
    renderBrokerCards();
    return;
  }
  try {
    const result = await apiFetchJson("/api/snaptrade/connections");
    brokerConnections = safeArray(result.data).map(normalizeSnapTradeConnection);
  } catch (error) {
    console.warn("SnapTrade connections unavailable:", error);
    brokerConnections = [];
    snapTradeStatus(error.message || "SnapTrade connections are unavailable.", true);
  }
  renderBrokerCards();
}

async function fetchPortfolio() {
  if (snapTradeUser) {
    try {
      const result = await apiFetchJson("/api/snaptrade/portfolio");
      if (!result.success || !result.data) {
        throw new Error("SnapTrade portfolio response was incomplete");
      }
      livePortfolio = result.data;
      livePortfolioSource = "snaptrade";
      portfolioFetchStatus = "live";
      portfolioLastSyncAt = new Date();
      setBackendStatus("Live", true);
      snapTradeStatus(
        safeArray(livePortfolio.accounts).length
          ? "SnapTrade portfolio loaded."
          : "SnapTrade is ready. Connect a brokerage account to load holdings."
      );
      renderPortfolioSummary();
      renderAccountsList();
      renderHoldingsTable();
      renderPlaidInvestments();
      return;
    } catch (error) {
      console.warn("SnapTrade portfolio unavailable:", error);
      snapTradeStatus(error.message || "SnapTrade portfolio is unavailable.", true);
    }
  }

  try {
    const response = await fetch(`${BACKEND_URL}/api/portfolio`, {
      credentials: "include"
    });
    if (!response.ok) throw new Error(`Portfolio request failed with ${response.status}`);
    const result = await response.json();
    if (!result.success || !result.data) throw new Error("Portfolio response is incomplete");
    livePortfolio = result.data;
    livePortfolioSource = String(result.source || result.data.source || "mock").toLowerCase();
    portfolioFetchStatus = livePortfolioSource === "robinhood" ? "live" : "mock";
    portfolioLastSyncAt = new Date();
  } catch (error) {
    console.warn("Portfolio fallback unavailable:", error);
    portfolioFetchStatus = "offline";
  }
  renderPortfolioSummary();
  renderAccountsList();
  renderHoldingsTable();
}

function normalizePortfolioSource(source) {
  const value = String(source || "mock").trim().toLowerCase();
  if (value === "snaptrade") return "snaptrade";
  if (value === "robinhood") return "robinhood";
  return "mock";
}

function getPortfolioSourceLabel() {
  if (portfolioFetchStatus === "live" && livePortfolioSource === "snaptrade") {
    return "snaptrade/live";
  }
  if (portfolioFetchStatus === "live" && livePortfolioSource === "robinhood") {
    return "robinhood/live";
  }
  return portfolioFetchStatus === "mock" ? "mock/mode" : "offline";
}

function getPortfolioConnectionLabel() {
  if (portfolioFetchStatus === "live" && livePortfolioSource === "snaptrade") {
    return "SnapTrade Connected";
  }
  if (portfolioFetchStatus === "live" && livePortfolioSource === "robinhood") {
    return "Robinhood Connected";
  }
  return portfolioFetchStatus === "mock" ? "Mock Mode" : "Offline";
}

function getPortfolioDataSourceLabel() {
  if (portfolioFetchStatus === "live" && livePortfolioSource === "snaptrade") {
    return "Live Data Source: SnapTrade";
  }
  if (portfolioFetchStatus === "live" && livePortfolioSource === "robinhood") {
    return "Live Data Source: Robinhood";
  }
  return portfolioFetchStatus === "mock"
    ? "Live Data Source: Mock"
    : "Live Data Source: Offline";
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
  const dayChange = getPortfolioValue(["day_change", "dailyChange", "dayChange"], 0);
  const dayPercent = getPortfolioValue(
    ["day_change_percent", "dailyPercent", "dayChangePercent"],
    0
  );
  const holdings = getLiveHoldings();
  const accountCount = safeArray(livePortfolio?.accounts).length;

  setText("portfolioValue", formatCurrency(totalValue));
  setText("buyingPower", formatCurrency(buyingPower));
  setText("cash", formatCurrency(cash));
  setText("investedValue", formatCurrency(investedValue));
  setText("dailyPL", formatCurrency(dayChange));
  setText("dailyPercent", formatPercent(dayPercent));
  setText("openPositions", holdings.length || livePortfolio?.open_positions || 0);
  setText("accountCount", `${accountCount} account${accountCount === 1 ? "" : "s"} connected`);
  setText("portfolioSource", getPortfolioSourceLabel());
  setText("portfolioConnectionStatus", getPortfolioConnectionLabel());
  setText("portfolioLastSync", getLastSyncLabel());
  setText("portfolioDataSource", getPortfolioDataSourceLabel());
  setClass("dailyPL", getChangeClass(dayChange));
  setClass("dailyPercent", getChangeClass(dayChange));
}

function maskSnapTradeAccountNumber(value) {
  const clean = String(value || "").replace(/\s+/g, "");
  return clean ? `•••• ${clean.slice(-4)}` : "Hidden";
}

function renderPlaidInvestments() {
  const summary = document.getElementById("plaidInvestmentSummary");
  if (!summary) return;
  const accounts = safeArray(livePortfolio?.accounts).length;
  const holdings = getLiveHoldings().length;
  summary.textContent = snapTradeUser
    ? `SnapTrade data: ${accounts} account${accounts === 1 ? "" : "s"}, ${holdings} holding${holdings === 1 ? "" : "s"}.`
    : "";
  summary.className = `plaid-investment-summary ${accounts || holdings ? "status-connected" : "muted"}`;
}

function renderAccountsList() {
  const list = document.getElementById("accountsList");
  if (!list) return;

  const accounts = safeArray(livePortfolio?.accounts);
  if (livePortfolioSource === "snaptrade" && accounts.length) {
    list.innerHTML = accounts.map((account) => `
      <article class="account-card">
        <h4>${escapeHtml(account.name || "Investment Account")}</h4>
        <span class="status-pill status-connected">Connected</span>
        <p>Account Number: <strong>${escapeHtml(maskSnapTradeAccountNumber(account.account_number))}</strong></p>
        <p>Total Value: <strong>${formatCurrency(account.total_value)}</strong></p>
        <p>Cash: <strong>${formatCurrency(account.cash)}</strong></p>
        <p>Buying Power: <strong>${formatCurrency(account.buying_power)}</strong></p>
      </article>
    `).join("");
    return;
  }

  if (!snapTradeUser) {
    list.innerHTML = `
      <article class="account-card">
        <h4>Private Portfolio</h4>
        <span class="status-pill status-coming">Sign In Required</span>
        <p class="muted">Your brokerage accounts remain hidden until you sign in.</p>
      </article>
    `;
    return;
  }

  list.innerHTML = `
    <article class="account-card">
      <h4>No Brokerage Connected</h4>
      <span class="status-pill status-coming">SnapTrade Ready</span>
      <p class="muted">Use Connect Brokerage to link an investment account.</p>
    </article>
  `;
}

function renderBrokerCards() {
  const cards = document.getElementById("brokerCards");
  if (!cards) return;
  const connections = brokerConnections.map((connection) => `
    <article class="broker-card">
      <h4>${escapeHtml(connection.name)}</h4>
      <span class="status-pill ${connection.status === "connected" ? "status-connected" : "status-coming"}">${escapeHtml(connection.status)}</span>
      <p class="muted">${formatConnectionSync(connection.last_connected)}</p>
      <button onclick="connectBroker()">Reconnect or Add Account</button>
    </article>
  `).join("");

  cards.innerHTML = `
    <article class="broker-card">
      <h4>SnapTrade</h4>
      <span class="status-pill ${snapTradeUser ? "status-connected" : "status-coming"}">${snapTradeUser ? "Ready" : "Sign In Required"}</span>
      <p class="muted">Secure read-only brokerage linking for supported investment institutions.</p>
      <button onclick="connectBroker()" ${!snapTradeUser || snapTradeConnectBusy ? "disabled" : ""}>${snapTradeConnectBusy ? "Opening..." : "Connect Brokerage"}</button>
    </article>
    ${connections}
  `;
}

function connectBroker() {
  connectWithSnapTrade();
}

async function fetchAggregatePortfolio() {
  if (snapTradeUser) {
    try {
      const result = await apiFetchJson("/api/snaptrade/portfolio");
      const data = result.data || {};
      aggregatePortfolio = {
        total_value: data.total_value,
        cash: data.cash,
        buying_power: data.buying_power,
        invested_value: data.invested_value,
        sync_status: {
          state: "live",
          included_brokers: brokerConnections.map((item) => item.name),
          skipped_brokers: []
        }
      };
      aggregatePortfolioStatus = "live";
      renderAggregatePortfolio();
      return;
    } catch (error) {
      console.warn("SnapTrade aggregate portfolio unavailable:", error);
    }
  }
  aggregatePortfolioStatus = "offline";
  renderAggregatePortfolio();
}

async function handleSnapTradeReturn() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get("status");
  if (!status) return;

  window.history.replaceState(
    {},
    document.title,
    `${window.location.origin}${window.location.pathname}${window.location.hash || ""}`
  );

  if (status === "SUCCESS") {
    snapTradeStatus("Brokerage connected successfully. Refreshing your portfolio...");
    await Promise.allSettled([fetchBrokerConnections(), fetchPortfolio()]);
    return;
  }
  if (status === "ABANDONED") {
    snapTradeStatus("SnapTrade connection was closed before completion.");
    return;
  }
  snapTradeStatus(
    `SnapTrade connection failed: ${params.get("error_code") || "unknown error"}`,
    true
  );
}

async function initializeSnapTrade() {
  plaidMessage = "Sign in to connect brokerage accounts with SnapTrade.";
  installSnapTradeUi();
  snapTradeStatus(plaidMessage);
  renderSnapTradeAuth();
  await checkSnapTradeAuth();
  if (snapTradeUser) {
    await Promise.allSettled([
      fetchBrokerConnections(),
      fetchPortfolio(),
      fetchAggregatePortfolio()
    ]);
  } else {
    renderAccountsList();
    renderBrokerCards();
  }
  await handleSnapTradeReturn();
}

document.addEventListener("DOMContentLoaded", () => {
  initializeSnapTrade().catch((error) => {
    console.warn("SnapTrade initialization failed:", error);
    snapTradeStatus("SnapTrade initialization failed.", true);
  });
});
