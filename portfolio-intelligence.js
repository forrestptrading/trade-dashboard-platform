/* Add connected-data portfolio insights to the Overview page. */
(() => {
  const PANEL_ID = "portfolioIntelligencePanel";
  const STYLE_ID = "portfolioIntelligenceStyles";

  function clampPercent(value) {
    return Math.min(100, Math.max(0, finiteNumber(value)));
  }

  function formatPercent(value) {
    return `${finiteNumber(value).toFixed(1)}%`;
  }

  function getSavedGoal() {
    const goal = finiteNumber(loadStoredJson(STORAGE_KEYS.goal, 0));
    return goal > 0 ? goal : 0;
  }

  function getInvestmentHoldings() {
    return safeArray(portfolio.holdings)
      .filter((holding) => !holding.cash_equivalent)
      .map((holding) => ({
        ...holding,
        market_value: Math.max(0, finiteNumber(holding.market_value))
      }))
      .filter((holding) => holding.market_value > 0);
  }

  function getConcentrationLabel(share) {
    if (!Number.isFinite(share)) return "Unavailable";
    if (share >= 35) return "High concentration";
    if (share >= 20) return "Monitor concentration";
    return "Broadly spread";
  }

  function injectPortfolioIntelligenceStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .portfolio-intelligence-panel { margin-bottom: 20px; }
      .portfolio-intelligence-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 14px;
      }
      .intelligence-card {
        background: linear-gradient(145deg, var(--surface, #2a171d), var(--card, #211116));
        color: var(--text, #f7eef0);
        border: 1px solid var(--border, #4a252f);
        border-radius: 14px;
        padding: 16px;
        min-width: 0;
        box-shadow: 0 10px 24px rgba(0,0,0,.18);
      }
      .intelligence-card > span {
        display: block;
        color: var(--muted, #c8aeb4);
        font-size: 13px;
        margin-bottom: 8px;
        opacity: 1;
      }
      .intelligence-card > strong {
        display: block;
        color: var(--text, #f7eef0);
        font-size: 22px;
        margin-bottom: 6px;
        overflow-wrap: anywhere;
      }
      .intelligence-card small {
        display: block;
        color: var(--muted, #c8aeb4);
        line-height: 1.4;
        opacity: 1;
      }
      .allocation-meter,
      .goal-meter {
        display: flex;
        height: 10px;
        margin: 12px 0 8px;
        overflow: hidden;
        border: 1px solid var(--border, #4a252f);
        border-radius: 999px;
        background: #14090d;
      }
      .allocation-invested,
      .goal-meter-fill {
        background: linear-gradient(90deg, var(--accent, #a92d40), var(--accent-hover, #c53b50));
      }
      .allocation-cash {
        background: var(--green, #4dd47a);
      }
      .goal-meter-fill,
      .allocation-invested,
      .allocation-cash {
        min-width: 0;
        transition: width .25s ease;
      }
      .allocation-legend {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        color: var(--muted, #c8aeb4);
        font-size: 12px;
      }
      @media (max-width: 600px) {
        .portfolio-intelligence-grid { grid-template-columns: 1fr; }
      }
    `;
    document.head.appendChild(style);
  }

  function ensurePortfolioIntelligencePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    const summaryGrid = document.querySelector("#overview .summary-grid");
    if (!summaryGrid) return null;

    panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.className = "panel portfolio-intelligence-panel";
    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <h3>Portfolio Intelligence</h3>
          <p>Derived only from connected brokerage totals and positions.</p>
        </div>
      </div>
      <div id="portfolioIntelligenceGrid" class="portfolio-intelligence-grid"></div>
    `;
    summaryGrid.insertAdjacentElement("afterend", panel);
    return panel;
  }

  function renderPortfolioIntelligence() {
    injectPortfolioIntelligenceStyles();
    const panel = ensurePortfolioIntelligencePanel();
    const grid = panel?.querySelector("#portfolioIntelligenceGrid");
    if (!grid) return;

    const connected = Boolean(currentUser && safeArray(portfolio.accounts).length);
    if (!connected) {
      grid.innerHTML = '<p class="muted">Sign in and connect a brokerage account to calculate portfolio insights.</p>';
      return;
    }

    const totalValue = Math.max(0, finiteNumber(portfolio.total_value));
    const cashValue = Math.max(0, finiteNumber(portfolio.cash));
    const investedValue = Math.max(0, finiteNumber(portfolio.invested_value));
    const cashShare = totalValue > 0 ? clampPercent((cashValue / totalValue) * 100) : 0;
    const investedShare = totalValue > 0 ? clampPercent((investedValue / totalValue) * 100) : 0;

    const goal = getSavedGoal();
    const goalProgress = goal > 0 ? clampPercent((totalValue / goal) * 100) : 0;
    const goalRemaining = goal > 0 ? Math.max(0, goal - totalValue) : 0;
    const goalHeadline = goal > 0 ? formatPercent(goalProgress) : "No goal set";
    const goalDetail = goal > 0
      ? goalRemaining > 0
        ? `${formatCurrency(goalRemaining)} remaining to reach ${formatCurrency(goal)}.`
        : `Goal reached. Current value is ${formatCurrency(totalValue)}.`
      : "Set a portfolio goal in Settings to track progress here.";

    const holdings = getInvestmentHoldings().sort((a, b) => b.market_value - a.market_value);
    const largest = holdings[0] || null;
    const holdingsMarketValue = holdings.reduce((sum, holding) => sum + holding.market_value, 0);
    const concentrationBase = investedValue > 0 ? investedValue : holdingsMarketValue;
    const largestShare = largest && concentrationBase > 0
      ? clampPercent((largest.market_value / concentrationBase) * 100)
      : Number.NaN;
    const largestName = largest
      ? escapeHtml(largest.symbol || largest.option_symbol || "Position")
      : "Unavailable";
    const largestDetail = largest
      ? `${formatCurrency(largest.market_value)} · ${formatPercent(largestShare)} of reported invested value.`
      : "No priced investment positions were returned.";
    const concentrationLabel = getConcentrationLabel(largestShare);
    const concentrationDetail = Number.isFinite(largestShare)
      ? `Largest position share: ${formatPercent(largestShare)}.`
      : "Concentration cannot be calculated from the current feed.";

    grid.innerHTML = `
      <article class="intelligence-card">
        <span>Portfolio Goal</span>
        <strong>${escapeHtml(goalHeadline)}</strong>
        <div class="goal-meter" aria-label="Portfolio goal progress">
          <div class="goal-meter-fill" style="width:${goalProgress}%"></div>
        </div>
        <small>${escapeHtml(goalDetail)}</small>
      </article>
      <article class="intelligence-card">
        <span>Reported Allocation</span>
        <strong>${formatPercent(investedShare)} invested</strong>
        <div class="allocation-meter" aria-label="Cash and invested allocation">
          <div class="allocation-invested" style="width:${investedShare}%"></div>
          <div class="allocation-cash" style="width:${cashShare}%"></div>
        </div>
        <div class="allocation-legend">
          <span>Invested ${formatPercent(investedShare)}</span>
          <span>Cash ${formatPercent(cashShare)}</span>
        </div>
      </article>
      <article class="intelligence-card">
        <span>Largest Position</span>
        <strong>${largestName}</strong>
        <small>${escapeHtml(largestDetail)}</small>
      </article>
      <article class="intelligence-card">
        <span>Concentration Flag</span>
        <strong>${escapeHtml(concentrationLabel)}</strong>
        <small>${escapeHtml(concentrationDetail)}</small>
      </article>
    `;
  }

  const baseRenderPortfolio = renderPortfolio;
  renderPortfolio = function renderPortfolioWithIntelligence() {
    baseRenderPortfolio();
    renderPortfolioIntelligence();
  };

  const baseSaveGoal = saveGoal;
  saveGoal = function saveGoalWithIntelligence() {
    baseSaveGoal();
    renderPortfolioIntelligence();
  };

  document.addEventListener("DOMContentLoaded", renderPortfolioIntelligence);
})();