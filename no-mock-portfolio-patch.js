/* Production dashboard: show only connected SnapTrade data, never mock portfolio values. */
function emptySnapTradePortfolio() {
  return {
    source: "snaptrade",
    account_name: "SnapTrade",
    total_value: 0,
    cash: 0,
    buying_power: 0,
    invested_value: 0,
    day_change: 0,
    day_change_percent: 0,
    accounts: [],
    holdings: [],
    open_positions: 0,
    updated_at: null
  };
}

function clearDisconnectedPortfolio(message, isError = false) {
  livePortfolio = emptySnapTradePortfolio();
  livePortfolioSource = "snaptrade";
  portfolioFetchStatus = "offline";
  portfolioLastSyncAt = null;

  if (message) snapTradeStatus(message, isError);

  renderPortfolioSummary();
  renderAccountsList();
  renderHoldingsTable();
  renderPlaidInvestments();
}

async function fetchPortfolio() {
  if (!snapTradeUser) {
    clearDisconnectedPortfolio(
      "Sign in and connect a brokerage to load live investment data."
    );
    return;
  }

  try {
    const result = await apiFetchJson("/api/snaptrade/portfolio");

    if (!result.success || !result.data) {
      throw new Error("SnapTrade portfolio response was incomplete");
    }

    livePortfolio = {
      ...emptySnapTradePortfolio(),
      ...result.data,
      accounts: safeArray(result.data.accounts),
      holdings: safeArray(result.data.holdings)
    };
    livePortfolioSource = "snaptrade";
    portfolioFetchStatus = "live";
    portfolioLastSyncAt = new Date();
    setBackendStatus("Live", true);

    snapTradeStatus(
      livePortfolio.accounts.length
        ? "SnapTrade portfolio loaded."
        : "SnapTrade is ready. Connect a brokerage account to load holdings."
    );
  } catch (error) {
    console.warn("SnapTrade portfolio unavailable:", error);
    clearDisconnectedPortfolio(
      error.message || "SnapTrade portfolio is unavailable.",
      true
    );
    return;
  }

  renderPortfolioSummary();
  renderAccountsList();
  renderHoldingsTable();
  renderPlaidInvestments();
}

function getPortfolioSourceLabel() {
  return portfolioFetchStatus === "live" && livePortfolioSource === "snaptrade"
    ? "snaptrade/live"
    : "snaptrade/not-connected";
}

function getPortfolioConnectionLabel() {
  return portfolioFetchStatus === "live" && livePortfolioSource === "snaptrade"
    ? "SnapTrade Connected"
    : "Not Connected";
}

function getPortfolioDataSourceLabel() {
  return portfolioFetchStatus === "live" && livePortfolioSource === "snaptrade"
    ? "Live Data Source: SnapTrade"
    : "Live Data Source: Not Connected";
}

function renderPortfolioSummary() {
  const totalValue = getPortfolioValue(
    ["total_value", "totalValue", "total", "balance", "equity", "account_value"],
    0
  );
  const buyingPower = getPortfolioValue(
    ["buying_power", "buyingPower", "available_buying_power"],
    0
  );
  const cash = getPortfolioValue(
    ["cash", "cash_balance", "cashBalance", "cash_available"],
    0
  );
  const investedValue = getPortfolioValue(
    ["invested_value", "investedValue", "market_value", "marketValue"],
    0,
    true
  );
  const dayChange = getPortfolioValue(
    ["day_change", "dailyChange", "dayChange"],
    0
  );
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
  setText("openPositions", holdings.length);
  setText(
    "accountCount",
    `${accountCount} account${accountCount === 1 ? "" : "s"} connected`
  );
  setText("portfolioSource", getPortfolioSourceLabel());
  setText("portfolioConnectionStatus", getPortfolioConnectionLabel());
  setText("portfolioLastSync", getLastSyncLabel());
  setText("portfolioDataSource", getPortfolioDataSourceLabel());
  setClass("dailyPL", getChangeClass(dayChange));
  setClass("dailyPercent", getChangeClass(dayChange));
}

function renderHoldingsTable() {
  const holdingsTable = document.getElementById("holdingsTable");
  if (!holdingsTable) return;

  const holdings = getLiveHoldings();

  if (portfolioFetchStatus !== "live") {
    holdingsTable.innerHTML = `
      <p class="muted">
        No live brokerage data is connected. Sign in and connect an investment account through SnapTrade.
      </p>
    `;
    return;
  }

  if (!holdings.length) {
    holdingsTable.innerHTML = `
      <p class="muted">
        SnapTrade is connected, but no holdings were returned for the linked account.
      </p>
    `;
    return;
  }

  const rows = holdings.map(normalizeHoldingRow).filter(Boolean);

  if (!rows.length) {
    holdingsTable.innerHTML = `
      <p class="muted">
        Holdings were returned, but none contained enough valid data to display.
      </p>
    `;
    return;
  }

  holdingsTable.innerHTML = rows.map((holding) => `
    <div class="table-row">
      <strong>${escapeHtml(holding.symbol)}</strong>
      <span>${holding.quantity.toLocaleString()} shares</span>
      <span>Current: ${holding.currentPrice ? formatCurrency(holding.currentPrice) : "--"}</span>
      <span>Value: ${formatCurrency(holding.marketValue)}</span>
      <span class="${getChangeClass(holding.todaysChange)}">
        Today: ${formatCurrency(holding.todaysChange)}
      </span>
      <span class="${getChangeClass(holding.totalGainLoss)}">
        Total: ${formatCurrency(holding.totalGainLoss)} (${formatPercent(holding.totalGainLossPercent)})
      </span>
    </div>
  `).join("");
}
