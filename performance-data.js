/* Calculate cost basis and unrealized performance only from connected SnapTrade position fields. */
(() => {
  function positionPerformance(holding) {
    const quantity = optionalFiniteNumber(holding?.quantity);
    const averagePrice = optionalFiniteNumber(holding?.average_price);
    const marketValue = optionalFiniteNumber(holding?.market_value);

    if (quantity === null || quantity === 0 || averagePrice === null || marketValue === null) {
      return null;
    }

    const signedCostBasis = quantity * averagePrice;
    const unrealized = marketValue - signedCostBasis;
    const returnPercent = signedCostBasis === 0
      ? null
      : (unrealized / Math.abs(signedCostBasis)) * 100;

    return {
      averagePrice,
      costBasis: Math.abs(signedCostBasis),
      unrealized,
      returnPercent
    };
  }

  function performanceTotals(holdings) {
    return safeArray(holdings)
      .filter((holding) => !holding.cash_equivalent)
      .map(positionPerformance)
      .filter(Boolean)
      .reduce(
        (totals, item) => {
          totals.costBasis += item.costBasis;
          totals.unrealized += item.unrealized;
          totals.positions += 1;
          return totals;
        },
        { costBasis: 0, unrealized: 0, positions: 0 }
      );
  }

  function performancePercent(totals) {
    return totals.costBasis > 0
      ? (totals.unrealized / totals.costBasis) * 100
      : null;
  }

  function signedClass(value) {
    if (value > 0) return "positive";
    if (value < 0) return "negative";
    return "";
  }

  function signedCurrency(value) {
    const amount = finiteNumber(value);
    return `${amount > 0 ? "+" : ""}${formatCurrency(amount)}`;
  }

  function signedPercent(value) {
    const percent = optionalFiniteNumber(value);
    return percent === null ? "--" : `${percent > 0 ? "+" : ""}${percent.toFixed(2)}%`;
  }

  function ensurePerformanceCards() {
    const grid = document.querySelector("#overview .summary-grid");
    if (!grid || document.getElementById("portfolioCostBasis")) return;

    grid.insertAdjacentHTML(
      "beforeend",
      `<article class="summary-card" data-connected-performance>
        <span>Total Cost Basis</span>
        <strong id="portfolioCostBasis">--</strong>
        <small id="portfolioCostBasisNote">Waiting for brokerage cost data</small>
      </article>
      <article class="summary-card" data-connected-performance>
        <span>Unrealized P/L</span>
        <strong id="portfolioUnrealizedPL">--</strong>
        <small id="portfolioUnrealizedPercent">Waiting for brokerage cost data</small>
      </article>`
    );
  }

  function renderPerformanceSummary() {
    ensurePerformanceCards();
    const totals = performanceTotals(portfolio.holdings);
    const percent = performancePercent(totals);
    const pnlElement = document.getElementById("portfolioUnrealizedPL");

    if (!currentUser || !safeArray(portfolio.accounts).length || !totals.positions) {
      setText("portfolioCostBasis", "--");
      setText("portfolioCostBasisNote", "Cost basis unavailable from the connected feed");
      setText("portfolioUnrealizedPL", "--");
      setText("portfolioUnrealizedPercent", "Performance unavailable from the connected feed");
      if (pnlElement) pnlElement.className = "";
      return;
    }

    setText("portfolioCostBasis", formatCurrency(totals.costBasis));
    setText("portfolioCostBasisNote", `${totals.positions} position${totals.positions === 1 ? "" : "s"} with brokerage cost data`);
    setText("portfolioUnrealizedPL", signedCurrency(totals.unrealized));
    setText("portfolioUnrealizedPercent", `${signedPercent(percent)} since purchase`);
    if (pnlElement) pnlElement.className = signedClass(totals.unrealized);
  }

  function appendAccountPerformance() {
    const container = document.getElementById("accountsList");
    const accounts = safeArray(portfolio.accounts);
    if (!container || !currentUser || !accounts.length) return;

    const cards = [...container.querySelectorAll(".account-card")];
    accounts.forEach((account, index) => {
      const card = cards[index];
      if (!card) return;

      const accountHoldings = safeArray(portfolio.holdings).filter(
        (holding) => holding.account_id === account.id && !holding.cash_equivalent
      );
      const totals = performanceTotals(accountHoldings);
      const percent = performancePercent(totals);
      const block = document.createElement("div");
      block.setAttribute("data-account-performance", "true");

      if (!totals.positions) {
        block.innerHTML = '<p class="muted">Cost basis was not supplied for this account.</p>';
      } else {
        block.innerHTML = `
          <p>Cost Basis: <strong>${formatCurrency(totals.costBasis)}</strong></p>
          <p>Unrealized P/L: <strong class="${signedClass(totals.unrealized)}">${signedCurrency(totals.unrealized)} (${signedPercent(percent)})</strong></p>`;
      }
      card.appendChild(block);
    });
  }

  function appendPositionPerformance(containerId, holdings, averageLabel) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const rows = [...container.querySelectorAll(".table-row")];

    holdings.forEach((holding, index) => {
      const row = rows[index];
      if (!row) return;
      const result = positionPerformance(holding);

      if (!result) {
        const unavailable = document.createElement("span");
        unavailable.className = "muted";
        unavailable.textContent = "Cost data unavailable";
        row.appendChild(unavailable);
        return;
      }

      const average = document.createElement("span");
      average.textContent = `${averageLabel}: ${formatCurrency(result.averagePrice)}`;

      const cost = document.createElement("span");
      cost.textContent = `Cost Basis: ${formatCurrency(result.costBasis)}`;

      const pnl = document.createElement("span");
      pnl.className = signedClass(result.unrealized);
      pnl.textContent = `Unrealized: ${signedCurrency(result.unrealized)} (${signedPercent(result.returnPercent)})`;

      row.append(average, cost, pnl);
    });
  }

  const baseRenderPortfolio = renderPortfolio;
  renderPortfolio = function renderPortfolioWithPerformance() {
    baseRenderPortfolio();
    renderPerformanceSummary();
  };

  const baseRenderAccounts = renderAccounts;
  renderAccounts = function renderAccountsWithPerformance() {
    baseRenderAccounts();
    appendAccountPerformance();
  };

  const baseRenderHoldings = renderHoldings;
  renderHoldings = function renderHoldingsWithPerformance() {
    baseRenderHoldings();
    const holdings = safeArray(portfolio.holdings).filter(
      (holding) => !holding.cash_equivalent && !isOptionHolding(holding)
    );
    appendPositionPerformance("holdingsTable", holdings, "Avg Cost");
  };

  const baseRenderOptions = renderOptions;
  renderOptions = function renderOptionsWithPerformance() {
    baseRenderOptions();
    const options = safeArray(portfolio.holdings).filter(
      (holding) => !holding.cash_equivalent && isOptionHolding(holding)
    );
    appendPositionPerformance("optionsTable", options, "Avg Contract Cost");
  };
})();
