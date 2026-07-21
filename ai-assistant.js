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

  function formatCompactNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "Unavailable";
    return new Intl.NumberFormat("en-US", {
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
      .market-scan-live { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border); font-size: 12.5px; display: grid; gap: 4px; }
      .market-scan-live-line span { opacity: .72; text-transform: uppercase; font-size: 10.5px; display: inline-block; min-width: 92px; }
      .market-scan-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 800; background: rgba(255,255,255,.12); margin-left: 6px; }
      .market-scan-badge.bullish { background: rgba(70,160,90,.25); }
      .market-scan-badge.bearish { background: rgba(190,70,80,.25); }
      .market-scan-option { margin-top: 8px; padding: 8px; border: 1px solid var(--border); border-radius: 10px; font-size: 12px; }
      .market-scan-note { margin-top: 6px; font-size: 11px; opacity: .7; }
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

  function formatMoney(value, digits = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "Unavailable";
    return `$${number.toFixed(digits)}`;
  }

  function liveLine(name, value) {
    const line = document.createElement("div");
    line.className = "market-scan-live-line";
    const key = document.createElement("span");
    key.textContent = name;
    const content = document.createElement("strong");
    content.textContent = value;
    line.append(key, content);
    return line;
  }

  const STAGE_STATUS_LABELS = {
    available: "Available",
    available_robinhood_fallback: "Available (Robinhood quote fallback)",
    delayed: "Delayed",
    plan_restricted: "Not in data plan",
    request_failed: "Request failed",
    not_requested: "Not requested at this stage"
  };

  function stageStatusText(entry) {
    if (!entry || !entry.status) return "Status unknown";
    return STAGE_STATUS_LABELS[entry.status] || entry.status;
  }

  function buildLiveSection(candidate) {
    const snapshot = candidate.live_snapshot;
    const quote = candidate.live_quote;
    const intraday = candidate.intraday;
    const news = candidate.news;
    const options = candidate.options;
    const statuses = candidate.enrichment_status || null;

    const section = document.createElement("div");
    section.className = "market-scan-live";

    if (snapshot) {
      section.appendChild(liveLine("Live price", snapshot.current_price !== null
        ? `${formatMoney(snapshot.current_price)}${snapshot.delayed ? " (delayed)" : ""}`
        : "Unavailable"));
      if (Number.isFinite(Number(snapshot.todays_change_percent))) {
        section.appendChild(liveLine("Today", formatPercent(snapshot.todays_change_percent)));
      }
      if (snapshot.current_volume !== null && snapshot.current_volume !== undefined) {
        section.appendChild(liveLine("Volume", formatCompactNumber(snapshot.current_volume)));
      }
      if (snapshot.data_timestamp) {
        section.appendChild(liveLine("As of", new Date(snapshot.data_timestamp).toLocaleTimeString()));
      }
    } else if (quote && quote.source === "robinhood_quote_fallback" && quote.current_price !== null) {
      section.appendChild(liveLine("Live price (Robinhood)", `${formatMoney(quote.current_price)}`));
      if (Number.isFinite(Number(quote.todays_change_percent))) {
        section.appendChild(liveLine("Today", formatPercent(quote.todays_change_percent)));
      }
      if (quote.bid !== null && quote.ask !== null) {
        const spreadText = quote.spread_percent !== null && quote.spread_percent !== undefined
          ? ` (spread ${Number(quote.spread_percent).toFixed(2)}%)`
          : "";
        section.appendChild(liveLine("Bid / Ask", `${formatMoney(quote.bid)} / ${formatMoney(quote.ask)}${spreadText}`));
      }
      section.appendChild(liveLine("Volume", "Not part of the Robinhood quote"));
      if (quote.data_timestamp) {
        section.appendChild(liveLine("As of", new Date(quote.data_timestamp).toLocaleTimeString()));
      }
      if (quote.trading_halted) {
        section.appendChild(liveLine("Trading", "HALTED"));
      }
    } else {
      section.appendChild(liveLine("Live price", "Unavailable"));
    }

    if (intraday) {
      const direction = String(intraday.direction || "neutral");
      const badge = document.createElement("div");
      badge.className = "market-scan-live-line";
      const key = document.createElement("span");
      key.textContent = "Intraday";
      const badgeEl = document.createElement("em");
      badgeEl.className = `market-scan-badge ${direction}`;
      badgeEl.textContent = `${direction.toUpperCase()} ${intraday.intraday_setup_score || 0}/100`;
      badge.append(key, badgeEl);
      section.appendChild(badge);
      section.appendChild(liveLine("VWAP", intraday.session_vwap !== null
        ? `${formatMoney(intraday.session_vwap)} (${String(intraday.vwap_status || "unavailable").replace(/-/g, " ")})`
        : "Unavailable"));
      if (intraday.range_status && intraday.range_status !== "unavailable") {
        section.appendChild(liveLine("Range", intraday.range_status.replace(/-/g, " ")));
      }
      if (intraday.opening_range_high !== null && intraday.opening_range_low !== null) {
        section.appendChild(liveLine("Opening range", `${formatMoney(intraday.opening_range_low)} – ${formatMoney(intraday.opening_range_high)}`));
      }
      if (intraday.session_date) {
        section.appendChild(liveLine("Candles from", intraday.session_date));
      }
      if (intraday.confirmation_level !== null && intraday.invalidation_level !== null) {
        section.appendChild(liveLine("Confirm / Stop", `${formatMoney(intraday.confirmation_level)} / ${formatMoney(intraday.invalidation_level)}`));
        if (intraday.target_1 !== null) {
          section.appendChild(liveLine("Targets", `${formatMoney(intraday.target_1)}${intraday.target_2 !== null ? ` → ${formatMoney(intraday.target_2)}` : ""}`));
        }
      }
    }

    if (news) {
      section.appendChild(liveLine("News", news.latest_headline
        ? `${news.catalyst_found ? "Catalyst: " : ""}${news.latest_headline}`
        : "No ticker-specific news"));
    }

    if (options) {
      if (!options.options_chain_available) {
        section.appendChild(liveLine("Options", (options.data_notes && options.data_notes[0]) || "Options chain unavailable"));
      } else if (Array.isArray(options.contracts) && options.contracts.length) {
        options.contracts.slice(0, 2).forEach((contract) => {
          const box = document.createElement("div");
          box.className = "market-scan-option";
          const bidAsk = contract.bid !== null && contract.ask !== null
            ? `${formatMoney(contract.bid)} x ${formatMoney(contract.ask)}`
            : "quote unavailable";
          const spreadText = contract.spread_percent !== null && contract.spread_percent !== undefined
            ? `, spread ${contract.spread_amount !== null && contract.spread_amount !== undefined ? `${formatMoney(contract.spread_amount)} (${Number(contract.spread_percent).toFixed(1)}%)` : `${Number(contract.spread_percent).toFixed(1)}%`}`
            : "";
          box.textContent = `${String(contract.contract_type || "").toUpperCase()} $${contract.strike} exp ${contract.expiration} — ${bidAsk}${spreadText}, OI ${contract.open_interest ?? "n/a"}, IV ${contract.implied_volatility !== null ? `${(contract.implied_volatility * 100).toFixed(1)}%` : "n/a"}, delta ${contract.delta ?? "n/a"} — score ${contract.liquidity_score}/100`;
          box.title = "Deterministic backend option score; the AI does not calculate scores.";
          section.appendChild(box);
        });
      } else {
        section.appendChild(liveLine("Options", `Chain reviewed (${options.contracts_reviewed || 0} contracts); none passed the liquidity and staleness filters`));
      }
    }

    if (statuses) {
      const statusBox = document.createElement("div");
      statusBox.className = "market-scan-note market-scan-stage-status";
      const parts = [];
      const quoteEntry = statuses.live_quote;
      if (quoteEntry && quoteEntry.status !== "not_requested") {
        parts.push(`Quote: ${stageStatusText(quoteEntry)}`);
      }
      parts.push(`Snapshot: ${stageStatusText(statuses.snapshot)}`);
      parts.push(`Intraday: ${stageStatusText(statuses.intraday)}`);
      parts.push(`News: ${stageStatusText(statuses.news)}`);
      parts.push(`Options: ${stageStatusText(statuses.options)}`);
      statusBox.textContent = parts.join(" · ");
      const details = ["snapshot", "intraday", "news", "options"]
        .map((stage) => statuses[stage] && statuses[stage].detail ? `${stage}: ${statuses[stage].detail}` : null)
        .filter(Boolean);
      if (details.length) statusBox.title = details.join("\n");
      section.appendChild(statusBox);
    }

    const noteTexts = []
      .concat(Array.isArray(candidate.data_quality_notes) ? candidate.data_quality_notes : [])
      .concat(intraday && Array.isArray(intraday.data_notes) ? intraday.data_notes : []);
    if (noteTexts.length) {
      const note = document.createElement("div");
      note.className = "market-scan-note";
      note.textContent = noteTexts.slice(0, 2).join(" ");
      section.appendChild(note);
    }
    return section;
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
    const liveDetail = document.createElement("div");
    const sessionText = scan.market_session ? `Market session: ${scan.market_session}.` : "";
    liveDetail.textContent = `${Number(scan.snapshot_candidates_reviewed || 0)} snapshots, ${Number(scan.intraday_candidates_reviewed || 0)} intraday, ${Number(scan.news_candidates_reviewed || 0)} news, ${Number(scan.options_candidates_reviewed || 0)} options chains reviewed. ${sessionText}${scan.live_data_as_of ? ` Live data as of ${new Date(scan.live_data_as_of).toLocaleTimeString()}.` : ""}${scan.quote_fallback_used ? " Live prices supplied by the Robinhood quote fallback (Massive snapshots are plan-restricted)." : ""}`;
    const scopeDetail = document.createElement("div");
    if (scan.stage_scope) {
      const scope = scan.stage_scope;
      scopeDetail.textContent = `Pipeline scope: snapshots attempted for the top ${Number(scope.snapshot_attempts || 0)}, intraday for the top ${Number(scope.intraday_attempts || 0)}, news for the final ${Number(scope.news_attempts || 0)}, options for the final ${Number(scope.options_attempts || 0)}. "Not requested at this stage" means a candidate ranked below that stage's cutoff — it is not a data failure.`;
    }
    const method = document.createElement("div");
    method.textContent = scan.confidence_method || "Confidence method unavailable.";
    summary.append(title, detail, liveDetail, scopeDetail, method);
    if (Array.isArray(scan.unavailable_capabilities) && scan.unavailable_capabilities.length) {
      const caps = document.createElement("div");
      caps.textContent = `Unavailable on the current data plan: ${scan.unavailable_capabilities.map((item) => `${item.capability} (${item.reason})`).join("; ")}`;
      summary.appendChild(caps);
    }

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
      const liveSection = buildLiveSection(candidate);
      if (liveSection) card.appendChild(liveSection);
      grid.appendChild(card);
    });

    const warning = document.createElement("div");
    warning.className = "market-scan-warning";
    warning.textContent = "Confidence, intraday setup, and option scores are deterministic backend calculations, not probabilities of profit. Live enrichment covers only the top-ranked candidates by design: 'Not requested at this stage' means the candidate ranked below that stage's cutoff, 'Not in data plan' means the data plan blocks it, and 'Request failed' means a real error. Robinhood-fallback quotes are live quotes, not Massive snapshot data.";

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
    const prompt = [
      "Analyze the top five candidates from the server-generated full-market scan attached under market_scan in the dashboard context.",
      "Each candidate is a complete backend-enriched object: historical scan scores, live snapshot, intraday 5-minute technicals (VWAP, opening range, swing levels, momentum, confirmation/invalidation/targets), news, and — for the final two — a filtered options chain with deterministic backend option scores.",
      "All scores are deterministic backend calculations; do not recalculate or alter them.",
      "Use only the supplied fields. Never invent prices, levels, premiums, Greeks, or news. Explicitly call out anything marked unavailable.",
      "Compare the candidates, identify the strongest current setup or state that none is valid, and explain what data supports or is missing from that conclusion."
    ].join("\n").slice(0, 1_950);

    appendAssistantMessage("You", "Analyze the top five enriched full-market scanner candidates.");
    const pending = appendAssistantMessage("Assistant", "Reviewing the enriched scanner candidates (live snapshots, intraday levels, news, and option chains)...");

    try {
      const result = await apiFetchJson("/api/assistant/chat", {
        method: "POST",
        body: JSON.stringify({
          message: prompt,
          symbols: candidates.map((candidate) => candidate.symbol).filter(Boolean),
          history: [],
          include_market_scan: true,
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
        `Data through ${lastMarketScan.data_through || "unavailable"}; ${Number(lastMarketScan.returned_candidates || 0)} candidates shown with live enrichment (session: ${lastMarketScan.market_session || "unknown"}).`
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