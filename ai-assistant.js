/* Load dashboard runtime fixes, polish, the AI assistant, and market scanner controls. */
(() => {
  if (globalThis.__forrestAiAssistantLoaderReady) return;
  globalThis.__forrestAiAssistantLoaderReady = true;

  let lastMarketScan = null;
  let marketScanBusy = false;
  let scannerInstallAttempts = 0;

  function loadScript(id, src) {
    if (document.getElementById(id)) return;
    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = false;
    script.onerror = () => console.error(`Failed to load ${src}`);
    document.head.appendChild(script);
  }

  function openAssistantSection() {
    document.querySelectorAll(".nav-btn").forEach((button) => {
      button.classList.toggle("active", button.dataset.section === "assistant");
    });
    document.querySelectorAll(".page-section").forEach((section) => {
      section.classList.toggle("active-section", section.id === "assistant");
    });
  }

  function isSignedIn() {
    return typeof currentUser !== "undefined" && Boolean(currentUser);
  }

  function formatPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "Unavailable";
    return `${number >= 0 ? "+" : ""}${number.toFixed(2)}%`;
  }

  function formatCompactMoney(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "Unavailable";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1
    }).format(number);
  }

  function appendAssistantMessage(label, text) {
    const list = document.getElementById("assistantMessages");
    if (!list) return null;
    const article = document.createElement("article");
    article.className = "assistant-message assistant-message-bot";
    const heading = document.createElement("span");
    heading.className = "assistant-message-label";
    heading.textContent = label;
    const body = document.createElement("div");
    body.textContent = text;
    article.append(heading, body);
    list.appendChild(article);
    list.scrollTop = list.scrollHeight;
    return article;
  }

  function ensureMarketScannerStyles() {
    if (document.getElementById("marketScannerStyles")) return;
    const style = document.createElement("style");
    style.id = "marketScannerStyles";
    style.textContent = `
      .market-scan-message { margin-right: 0; }
      .market-scan-summary { display: grid; gap: 6px; margin-bottom: 14px; }
      .market-scan-summary strong { font-size: 16px; }
      .market-scan-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); }
      .market-scan-card { border: 1px solid var(--border); border-radius: 14px; padding: 14px; background: rgba(255,255,255,.045); }
      .market-scan-card-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
      .market-scan-symbol { font-size: 18px; font-weight: 800; }
      .market-scan-score { font-size: 14px; font-weight: 800; }
      .market-scan-meter { height: 9px; border-radius: 999px; overflow: hidden; background: rgba(255,255,255,.12); margin: 8px 0 12px; }
      .market-scan-meter > span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #b04b63, #f0a36b); }
      .market-scan-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 13px; }
      .market-scan-stats span { display: block; opacity: .72; font-size: 11px; text-transform: uppercase; margin-bottom: 2px; }
      .market-scan-warning { margin-top: 14px; font-size: 12px; opacity: .76; }
      .market-scan-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
      .market-scan-actions button { border: none; border-radius: 10px; padding: 10px 14px; cursor: pointer; font-weight: 800; }
      .market-scan-actions button:disabled { cursor: not-allowed; opacity: .55; }
    `;
    document.head.appendChild(style);
  }

  function setScannerStatus(title, note) {
    const titleElement = document.getElementById("marketScannerContext");
    const noteElement = document.getElementById("marketScannerContextNote");
    if (titleElement) titleElement.textContent = title;
    if (noteElement) noteElement.textContent = note;
  }

  function renderMarketScan(scan) {
    const list = document.getElementById("assistantMessages");
    if (!list) return;

    const article = document.createElement("article");
    article.className = "assistant-message assistant-message-bot market-scan-message";

    const label = document.createElement("span");
    label.className = "assistant-message-label";
    label.textContent = "Full Market Scanner";

    const summary = document.createElement("div");
    summary.className = "market-scan-summary";
    const title = document.createElement("strong");
    title.textContent = `${Number(scan.universe_scanned || 0).toLocaleString()} stocks scanned`;
    const detail = document.createElement("div");
    detail.textContent = `${Number(scan.eligible_after_filters || 0).toLocaleString()} passed the trend and liquidity filters. Historical data through ${scan.data_through || "unavailable"}.`;
    const method = document.createElement("div");
    method.textContent = scan.confidence_method || "Confidence method unavailable.";
    summary.append(title, detail, method);

    const grid = document.createElement("div");
    grid.className = "market-scan-grid";
    const candidates = Array.isArray(scan.candidates) ? scan.candidates : [];

    candidates.forEach((candidate, index) => {
      const score = Math.max(0, Math.min(100, Number(candidate.confidence_meter) || 0));
      const card = document.createElement("section");
      card.className = "market-scan-card";

      const header = document.createElement("div");
      header.className = "market-scan-card-header";
      const symbol = document.createElement("div");
      symbol.className = "market-scan-symbol";
      symbol.textContent = `${index + 1}. ${candidate.symbol || "Unknown"}`;
      const scoreText = document.createElement("div");
      scoreText.className = "market-scan-score";
      scoreText.textContent = `${score}/100 ${String(candidate.confidence_label || "").toUpperCase()}`;
      header.append(symbol, scoreText);

      const meter = document.createElement("div");
      meter.className = "market-scan-meter";
      const fill = document.createElement("span");
      fill.style.width = `${score}%`;
      meter.appendChild(fill);

      const stats = document.createElement("div");
      stats.className = "market-scan-stats";
      const values = [
        ["1-week trend", formatPercent(candidate.week_return_percent)],
        ["1-month trend", formatPercent(candidate.month_return_percent)],
        ["Latest close", Number.isFinite(Number(candidate.latest_close)) ? `$${Number(candidate.latest_close).toFixed(2)}` : "Unavailable"],
        ["Avg. dollar volume", formatCompactMoney(candidate.average_dollar_volume)],
        ["Trend segments", `${candidate.positive_trend_segments || 0}/${candidate.total_trend_segments || 0} positive`],
        ["Avg. sampled range", formatPercent(candidate.average_sampled_range_percent)]
      ];
      values.forEach(([name, value]) => {
        const item = document.createElement("div");
        const key = document.createElement("span");
        key.textContent = name;
        const content = document.createElement("strong");
        content.textContent = value;
        item.append(key, content);
        stats.appendChild(item);
      });

      card.append(header, meter, stats);
      grid.appendChild(card);
    });

    const warning = document.createElement("div");
    warning.className = "market-scan-warning";
    warning.textContent = "These are bullish underlying-stock research candidates, not verified option contracts. The confidence meter measures observed trend quality, liquidity, and stability. It is not a probability of profit. Options chains, premiums, spreads, open interest, implied volatility, and Greeks are not included yet.";

    const actions = document.createElement("div");
    actions.className = "market-scan-actions";
    const analyzeButton = document.createElement("button");
    analyzeButton.type = "button";
    analyzeButton.textContent = "Ask AI to Analyze Top 5";
    analyzeButton.disabled = !candidates.length;
    analyzeButton.addEventListener("click", () => analyzeTopCandidates(analyzeButton));
    actions.appendChild(analyzeButton);

    article.append(label, summary, grid, warning, actions);
    list.appendChild(article);
    list.scrollTop = list.scrollHeight;
  }

  function portfolioContext() {
    const source = typeof portfolio !== "undefined" && portfolio && typeof portfolio === "object"
      ? portfolio
      : {};
    const holdings = Array.isArray(source.holdings) ? source.holdings : [];
    return {
      total_value: source.total_value ?? null,
      cash: source.cash ?? null,
      buying_power: source.buying_power ?? null,
      invested_value: source.invested_value ?? null,
      day_change: source.day_change ?? null,
      day_change_percent: source.day_change_percent ?? null,
      data_as_of: source.data_as_of ?? null,
      retrieved_at: source.retrieved_at ?? null,
      holdings: holdings.slice(0, 30).map((holding) => ({
        symbol: holding.symbol || holding.option_symbol || "",
        quantity: holding.quantity ?? null,
        current_price: holding.current_price ?? null,
        average_price: holding.average_price ?? null,
        market_value: holding.market_value ?? null,
        asset_type: holding.asset_type || holding.type || null,
        account_name: holding.account_name || null
      }))
    };
  }

  async function analyzeTopCandidates(button) {
    const candidates = Array.isArray(lastMarketScan?.candidates)
      ? lastMarketScan.candidates.slice(0, 5)
      : [];
    if (!candidates.length || button.disabled) return;
    if (!isSignedIn()) {
      appendAssistantMessage("Assistant", "Sign in before requesting AI analysis of the market scan.");
      return;
    }

    button.disabled = true;
    button.textContent = "AI Reviewing...";
    const dataset = candidates.map((candidate) => (
      `${candidate.symbol}: score ${candidate.confidence_meter}/100, week ${candidate.week_return_percent}%, month ${candidate.month_return_percent}%, avg dollar volume ${candidate.average_dollar_volume}, avg range ${candidate.average_sampled_range_percent}%.`
    )).join("\n");
    const prompt = [
      "Analyze the top results from the server-generated full U.S. market historical scan for potential bullish call research.",
      "The confidence scores are deterministic setup-quality scores, not probabilities. Do not alter them.",
      "Use current live quote quality to reject any candidate whose present quote is stale, crossed, wide, or internally inconsistent.",
      "Do not select a strike or expiration because no options chain is supplied.",
      "Compare the candidates, identify the strongest one or return no valid current setup, and explain missing data.",
      `Historical scanner data through ${lastMarketScan.data_through}:`,
      dataset
    ].join("\n").slice(0, 1_950);

    appendAssistantMessage("You", "Analyze the top five full-market scanner results against current quote quality.");
    const pending = appendAssistantMessage("Assistant", "Comparing the historical trend scan with current live quotes...");

    try {
      const result = await apiFetchJson("/api/assistant/chat", {
        method: "POST",
        body: JSON.stringify({
          message: prompt,
          symbols: candidates.map((candidate) => candidate.symbol).filter(Boolean),
          history: [],
          portfolio: portfolioContext()
        })
      });
      pending?.remove();
      const answer = String(result.data?.answer || "").trim();
      appendAssistantMessage("Assistant", answer || "The AI assistant returned no analysis.");
    } catch (error) {
      pending?.remove();
      appendAssistantMessage("Assistant", `Market-scan analysis unavailable: ${error.message}`);
    } finally {
      button.disabled = false;
      button.textContent = "Ask AI to Analyze Top 5";
    }
  }

  async function runMarketScan(button) {
    if (marketScanBusy) return;
    openAssistantSection();
    if (!isSignedIn()) {
      appendAssistantMessage("Market Scanner", "Sign in to run the owner-only full-market historical scan.");
      return;
    }
    if (typeof apiFetchJson !== "function") {
      appendAssistantMessage("Market Scanner", "The dashboard API client is unavailable.");
      return;
    }

    marketScanBusy = true;
    button.disabled = true;
    button.textContent = "Scanning Market...";
    setScannerStatus("Market scan running", "Reviewing thousands of U.S. stocks across one-week and one-month trend anchors.");
    const pending = appendAssistantMessage("Market Scanner", "Loading full-market historical sessions and ranking bullish trend candidates. The first uncached scan can take several seconds...");

    try {
      const result = await apiFetchJson("/api/market-scan?limit=10");
      pending?.remove();
      if (!result?.data || !Array.isArray(result.data.candidates)) {
        throw new Error("The API returned an invalid market-scan response");
      }
      lastMarketScan = result.data;
      renderMarketScan(lastMarketScan);
      setScannerStatus(
        `${Number(lastMarketScan.universe_scanned || 0).toLocaleString()} stocks scanned`,
        `Data through ${lastMarketScan.data_through || "unavailable"}; ${Number(lastMarketScan.returned_candidates || 0)} top candidates displayed.`
      );
    } catch (error) {
      pending?.remove();
      appendAssistantMessage("Market Scanner", `Full-market scan unavailable: ${error.message}`);
      setScannerStatus("Market scan unavailable", error.message || "The scanner request failed.");
    } finally {
      marketScanBusy = false;
      button.disabled = false;
      button.textContent = "Scan Full Market";
    }
  }

  function installMarketScanner() {
    const quickActions = document.querySelector(".assistant-quick-actions");
    const contextList = document.querySelector(".assistant-context-list");
    if (!quickActions || !contextList) {
      scannerInstallAttempts += 1;
      if (scannerInstallAttempts < 100) setTimeout(installMarketScanner, 100);
      return;
    }
    if (document.getElementById("runFullMarketScanBtn")) return;

    ensureMarketScannerStyles();

    const button = document.createElement("button");
    button.id = "runFullMarketScanBtn";
    button.type = "button";
    button.textContent = "Scan Full Market";
    button.addEventListener("click", () => runMarketScan(button));
    quickActions.prepend(button);

    const contextCard = document.createElement("div");
    contextCard.className = "assistant-context-item";
    const title = document.createElement("strong");
    title.id = "marketScannerContext";
    title.textContent = "Full-market scanner ready";
    const note = document.createElement("span");
    note.id = "marketScannerContextNote";
    note.textContent = "Scans U.S. stocks using completed historical sessions and a transparent confidence score.";
    contextCard.append(title, note);
    contextList.appendChild(contextCard);
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest?.('[data-section="assistant"]');
    if (!button) return;
    event.preventDefault();
    openAssistantSection();
    document.getElementById("assistantInput")?.focus();
  });

  loadScript("dashboardRuntimeFixesLoader", "dashboard-runtime-fixes.js?v=1.0");
  loadScript("dashboardPolishLoader", "ui-polish.js?v=2.1");
  loadScript("assistantCoreLoader", "ai-assistant-core.js?v=1.1");
  installMarketScanner();
})();