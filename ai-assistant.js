/* Load dashboard runtime fixes, polish, the AI assistant, and market scanner controls. */
(() => {
  if (globalThis.__forrestAiAssistantLoaderReady) return;
  globalThis.__forrestAiAssistantLoaderReady = true;

  let lastMarketScan = null;
  let marketScanBusy = false;
  let projectionBusy = false;
  let lastProjection = null;
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
    if (typeof globalThis.activateDashboardSection === "function") {
      globalThis.activateDashboardSection("assistant");
      return;
    }
    // Safe fallback using fresh DOM queries
    document.querySelectorAll(".nav-btn[data-section]").forEach((button) => {
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
      .projection-panel { margin-top: 12px; padding: 12px; border: 1px solid var(--border); border-radius: 12px; background: rgba(255,255,255,.03); font-size: 12.5px; display: grid; gap: 8px; }
      .projection-headline { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-weight: 800; font-size: 13px; }
      .projection-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 800; background: rgba(255,255,255,.12); }
      .projection-badge.bullish { background: rgba(70,160,90,.3); }
      .projection-badge.bearish { background: rgba(190,70,80,.3); }
      .projection-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .projection-table th, .projection-table td { padding: 4px 6px; text-align: right; border-bottom: 1px solid var(--border); }
      .projection-table th:first-child, .projection-table td:first-child { text-align: left; }
      .projection-chart { width: 100%; height: auto; display: block; }
      .projection-note { font-size: 11px; opacity: .72; }
      .projection-list { margin: 0; padding-left: 16px; font-size: 12px; display: grid; gap: 2px; }
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
    skipped: "Skipped (in scope, no setup)",
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
      if (candidate.symbol) card.dataset.projectionSymbol = String(candidate.symbol).toUpperCase();
      grid.appendChild(card);
    });

    const warning = document.createElement("div");
    warning.className = "market-scan-warning";
    warning.textContent = "Confidence, intraday setup, and option scores are deterministic backend calculations, not probabilities of profit. Live enrichment covers only the top-ranked candidates by design: 'Not requested at this stage' means the candidate ranked below that stage's cutoff, 'Not in data plan' means the data plan blocks it, and 'Request failed' means a real error. Robinhood-fallback quotes are live quotes, not Massive snapshot data.";

    const actions = document.createElement("div");
    actions.className = "market-scan-actions";
    const analyzeButton = document.createElement("button");
    analyzeButton.type = "button";
    analyzeButton.dataset.role = "analyze-top5";
    analyzeButton.textContent = analyzeButtonLabel();
    analyzeButton.disabled = !candidates.length;
    analyzeButton.addEventListener("click", () => analyzeTopCandidates(analyzeButton));
    actions.appendChild(analyzeButton);

    const projectButton = document.createElement("button");
    projectButton.type = "button";
    projectButton.textContent = "Project Top 5";
    projectButton.disabled = !candidates.length;
    projectButton.addEventListener("click", () => runProjection(projectButton, grid));
    actions.appendChild(projectButton);

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

  function projectionMoney(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "n/a";
    return `$${number.toFixed(2)}`;
  }

  function analyzeButtonLabel() {
    return lastProjection ? "Ask AI to Explain Scan + Projections" : "Ask AI to Analyze Top 5";
  }

  function projectionUnavailableText(reason) {
    const detail = typeof reason === "string" && reason.trim() ? ` (${reason.trim()})` : "";
    return `Unavailable${detail}`;
  }

  function formatProjectionChatSummary(result) {
    const candidates = Array.isArray(result.candidates) ? result.candidates.slice() : [];
    candidates.sort((a, b) => (Number(a.rank) || 0) - (Number(b.rank) || 0));
    const anchorSourceLabels = {
      robinhood_quote_fallback: "live Robinhood quote",
      massive_snapshot: "Massive snapshot",
      latest_completed_close: "latest completed close (not a live price)"
    };
    const horizonDefs = [
      ["1 day", "one_day"],
      ["5 days", "five_day"],
      ["20 days", "twenty_day"]
    ];

    const blocks = candidates.map((candidate, index) => {
      const rank = Number(candidate.rank) || index + 1;
      const bias = String(candidate.direction_bias || "neutral").toUpperCase();
      const confidence = Number(candidate.projection_confidence_score);
      const confidenceText = Number.isFinite(confidence)
        ? `${confidence}/100 (${String(candidate.projection_confidence_label || "low")})`
        : "Unavailable";
      const lines = [`${rank}. ${candidate.symbol} — ${bias}, confidence ${confidenceText}`];

      if (candidate.projection_status !== "available") {
        lines.push(`Projection ${projectionUnavailableText(candidate.unavailable_reason)}`);
        return lines.join("\n");
      }

      const anchorPrice = Number(candidate.anchor_price);
      lines.push(
        Number.isFinite(anchorPrice)
          ? `Anchor: ${projectionMoney(anchorPrice)} from ${anchorSourceLabels[candidate.anchor_price_source] || candidate.anchor_price_source || "unknown source"}`
          : `Anchor: ${projectionUnavailableText(candidate.anchor_price_source === "unavailable" ? "no usable anchor price" : null)}`
      );

      const upRateParts = [];
      horizonDefs.forEach(([label, key]) => {
        const horizon = candidate.horizons?.[key];
        if (horizon && horizon.status === "available") {
          lines.push(`${label}: ${projectionMoney(horizon.bear_price)} / ${projectionMoney(horizon.base_price)} / ${projectionMoney(horizon.bull_price)} (bear/base/bull)`);
          const upRate = Number(horizon.historical_up_rate);
          const count = Number(horizon.analogue_count);
          if (Number.isFinite(upRate)) {
            upRateParts.push(`${label} ${(upRate * 100).toFixed(0)}%${Number.isFinite(count) ? ` across ${count} analogues` : ""}`);
          }
        } else {
          lines.push(`${label}: ${projectionUnavailableText(horizon?.unavailable_reason)}`);
        }
      });
      if (upRateParts.length) lines.push(`Analogue up-rate: ${upRateParts.join("; ")}`);

      const news = candidate.news_analysis;
      if (news) {
        const score = Number(news.aggregate_news_score);
        lines.push(
          Number.isFinite(score)
            ? `News: ${score > 0 ? "+" : ""}${score.toFixed(2)}, ${String(news.coverage_quality || "unavailable")} coverage`
            : `News: ${projectionUnavailableText(null)}`
        );
      } else {
        lines.push("News: Unavailable (no news analysis attached)");
      }

      const backtest = candidate.backtest && candidate.backtest.five_day;
      if (backtest && backtest.status === "available") {
        const accuracy = Number(backtest.directional_accuracy);
        const medianError = Number(backtest.median_absolute_error_percent);
        lines.push(`Backtest (5-day): ${Number.isFinite(accuracy) ? `${(accuracy * 100).toFixed(0)}% directional accuracy` : "accuracy unavailable"}; ${Number.isFinite(medianError) ? `median error ${medianError.toFixed(2)}pp` : "median error unavailable"} over ${Number(backtest.samples) || 0} samples`);
      } else {
        lines.push("Backtest (5-day): Unavailable (insufficient history)");
      }

      const driver = Array.isArray(candidate.drivers) && candidate.drivers.length ? candidate.drivers[0] : null;
      const risk = Array.isArray(candidate.risks) && candidate.risks.length ? candidate.risks[0] : null;
      if (driver) lines.push(`Driver: ${driver}`);
      if (risk) lines.push(`Risk: ${risk}`);

      return lines.join("\n");
    });

    if (!blocks.length) return "No projection candidates were returned.";
    return `${blocks.join("\n\n")}\n\nScenario bands are 20th/50th/80th percentile historical-analogue outcomes plus a capped news adjustment — not guaranteed price targets.`;
  }

  function buildProjectionChart(projection) {
    const horizonDefs = [
      ["Now", null],
      ["1d", projection.horizons?.one_day],
      ["5d", projection.horizons?.five_day],
      ["20d", projection.horizons?.twenty_day]
    ];
    const anchor = Number(projection.anchor_price);
    if (!Number.isFinite(anchor)) return null;

    const points = horizonDefs.map(([name, horizon], index) => {
      if (index === 0) return { name, bear: anchor, base: anchor, bull: anchor, available: true };
      if (!horizon || horizon.status !== "available") return { name, available: false };
      return {
        name,
        bear: Number(horizon.bear_price),
        base: Number(horizon.base_price),
        bull: Number(horizon.bull_price),
        available: [horizon.bear_price, horizon.base_price, horizon.bull_price].every((v) => Number.isFinite(Number(v)))
      };
    });
    const usable = points.filter((p) => p.available);
    if (usable.length < 2) return null;

    const width = 320;
    const height = 150;
    const padLeft = 52;
    const padRight = 34;
    const padTop = 14;
    const padBottom = 22;
    const values = usable.flatMap((p) => [p.bear, p.base, p.bull]);
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (max === min) { max += 1; min -= 1; }
    const span = max - min;
    min -= span * 0.08;
    max += span * 0.08;
    const xFor = (index) => padLeft + (index / (points.length - 1)) * (width - padLeft - padRight);
    const yFor = (value) => padTop + (1 - (value - min) / (max - min)) * (height - padTop - padBottom);

    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("class", "projection-chart");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label",
      `Projection cone for ${projection.symbol}: anchor ${projectionMoney(anchor)}; ` +
      usable.slice(1).map((p) => `${p.name} bear ${projectionMoney(p.bear)}, base ${projectionMoney(p.base)}, bull ${projectionMoney(p.bull)}`).join("; "));

    const availableIdx = points.map((p, i) => (p.available ? i : null)).filter((i) => i !== null);
    const coord = (i, v) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`;

    const cone = document.createElementNS(svgNs, "polygon");
    cone.setAttribute("points",
      availableIdx.map((i) => coord(i, points[i].bull)).concat(
        availableIdx.slice().reverse().map((i) => coord(i, points[i].bear))
      ).join(" "));
    cone.setAttribute("fill", "rgba(240,163,107,.18)");
    cone.setAttribute("stroke", "none");
    svg.appendChild(cone);

    const drawPath = (key, color, dash) => {
      const path = document.createElementNS(svgNs, "polyline");
      path.setAttribute("points", availableIdx.map((i) => coord(i, points[i][key])).join(" "));
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", "2");
      if (dash) path.setAttribute("stroke-dasharray", dash);
      svg.appendChild(path);
    };
    drawPath("bear", "rgba(190,70,80,.9)", "4 3");
    drawPath("base", "rgba(255,255,255,.9)", null);
    drawPath("bull", "rgba(70,160,90,.9)", "4 3");

    points.forEach((p, i) => {
      const tick = document.createElementNS(svgNs, "text");
      tick.setAttribute("x", xFor(i).toFixed(1));
      tick.setAttribute("y", String(height - 6));
      tick.setAttribute("text-anchor", "middle");
      tick.setAttribute("font-size", "9");
      tick.setAttribute("fill", "currentColor");
      tick.setAttribute("opacity", p.available ? "0.85" : "0.4");
      tick.textContent = p.available ? p.name : `${p.name} n/a`;
      svg.appendChild(tick);
      if (p.available && i > 0) {
        const dot = document.createElementNS(svgNs, "circle");
        dot.setAttribute("cx", xFor(i).toFixed(1));
        dot.setAttribute("cy", yFor(p.base).toFixed(1));
        dot.setAttribute("r", "2.5");
        dot.setAttribute("fill", "rgba(255,255,255,.95)");
        svg.appendChild(dot);
      }
    });

    const anchorLabel = document.createElementNS(svgNs, "text");
    anchorLabel.setAttribute("x", "2");
    anchorLabel.setAttribute("y", yFor(anchor).toFixed(1));
    anchorLabel.setAttribute("font-size", "9");
    anchorLabel.setAttribute("fill", "currentColor");
    anchorLabel.setAttribute("dominant-baseline", "middle");
    anchorLabel.textContent = projectionMoney(anchor);
    svg.appendChild(anchorLabel);

    const last = availableIdx[availableIdx.length - 1];
    [["bull", "rgba(70,160,90,.95)"], ["base", "rgba(255,255,255,.95)"], ["bear", "rgba(190,70,80,.95)"]].forEach(([key, color]) => {
      const text = document.createElementNS(svgNs, "text");
      text.setAttribute("x", String(width - padRight + 3));
      text.setAttribute("y", yFor(points[last][key]).toFixed(1));
      text.setAttribute("font-size", "8.5");
      text.setAttribute("fill", color);
      text.setAttribute("dominant-baseline", "middle");
      text.textContent = projectionMoney(points[last][key]);
      svg.appendChild(text);
    });

    return svg;
  }

  function buildProjectionPanel(projection, result) {
    const panel = document.createElement("div");
    panel.className = "projection-panel";

    const headline = document.createElement("div");
    headline.className = "projection-headline";
    const bias = String(projection.direction_bias || "neutral");
    const badge = document.createElement("em");
    badge.className = `projection-badge ${bias}`;
    badge.textContent = bias.toUpperCase();
    const confidence = document.createElement("span");
    confidence.textContent = `Projection confidence ${Number(projection.projection_confidence_score) || 0}/100 (${String(projection.projection_confidence_label || "low")})`;
    headline.append(badge, confidence);
    panel.appendChild(headline);

    if (projection.projection_status !== "available") {
      const reason = document.createElement("div");
      reason.textContent = `Projection unavailable: ${projection.unavailable_reason || "unknown reason"}`;
      panel.appendChild(reason);
      return panel;
    }

    const anchorSourceLabels = {
      robinhood_quote_fallback: "live Robinhood quote",
      massive_snapshot: "Massive snapshot",
      latest_completed_close: "latest completed close (not a live price)"
    };
    const anchorLine = document.createElement("div");
    anchorLine.textContent = `Anchor ${projectionMoney(projection.anchor_price)} — ${anchorSourceLabels[projection.anchor_price_source] || projection.anchor_price_source}${projection.quote_timestamp ? ` as of ${new Date(projection.quote_timestamp).toLocaleTimeString()}` : ""}`;
    panel.appendChild(anchorLine);

    const chart = buildProjectionChart(projection);
    if (chart) panel.appendChild(chart);

    const table = document.createElement("table");
    table.className = "projection-table";
    const head = document.createElement("tr");
    ["Horizon", "Bear (20th)", "Base (median)", "Bull (80th)", "Analogue up-rate", "Analogues"].forEach((text) => {
      const th = document.createElement("th");
      th.textContent = text;
      head.appendChild(th);
    });
    table.appendChild(head);
    [["1 day", projection.horizons.one_day], ["5 days", projection.horizons.five_day], ["20 days", projection.horizons.twenty_day]].forEach(([name, horizon]) => {
      const row = document.createElement("tr");
      const cells = horizon && horizon.status === "available"
        ? [name, projectionMoney(horizon.bear_price), projectionMoney(horizon.base_price), projectionMoney(horizon.bull_price), `${(Number(horizon.historical_up_rate) * 100).toFixed(0)}%`, String(horizon.analogue_count)]
        : [name, "unavailable", "—", "—", "—", "—"];
      cells.forEach((text) => {
        const td = document.createElement("td");
        td.textContent = text;
        row.appendChild(td);
      });
      if (horizon && horizon.status !== "available" && horizon.unavailable_reason) row.title = horizon.unavailable_reason;
      table.appendChild(row);
    });
    panel.appendChild(table);

    const news = projection.news_analysis;
    if (news) {
      const newsLine = document.createElement("div");
      const score = Number(news.aggregate_news_score) || 0;
      newsLine.textContent = `News score ${score > 0 ? "+" : ""}${score.toFixed(2)} (coverage: ${news.coverage_quality})${news.trend_and_market_only ? " — no supplied sentiment, trend-and-market-only" : ""}${news.sentiment_agreement === "conflicting" ? " — sentiments conflict" : ""}`;
      panel.appendChild(newsLine);
    }

    if (Array.isArray(projection.drivers) && projection.drivers.length) {
      const drivers = document.createElement("ul");
      drivers.className = "projection-list";
      projection.drivers.slice(0, 3).forEach((text) => {
        const li = document.createElement("li");
        li.textContent = `Driver: ${text}`;
        drivers.appendChild(li);
      });
      (Array.isArray(projection.risks) ? projection.risks.slice(0, 3) : []).forEach((text) => {
        const li = document.createElement("li");
        li.textContent = `Risk: ${text}`;
        drivers.appendChild(li);
      });
      panel.appendChild(drivers);
    }

    const backtest = projection.backtest && projection.backtest.five_day;
    const backtestLine = document.createElement("div");
    backtestLine.className = "projection-note";
    if (backtest && backtest.status === "available") {
      backtestLine.textContent = `Walk-forward backtest (5-day): ${(Number(backtest.directional_accuracy) * 100).toFixed(0)}% directional accuracy, median abs error ${Number(backtest.median_absolute_error_percent).toFixed(2)}pp over ${backtest.samples} samples.`;
    } else {
      backtestLine.textContent = "Walk-forward backtest: insufficient history for reliable accuracy metrics.";
    }
    panel.appendChild(backtestLine);

    const disclaimer = document.createElement("div");
    disclaimer.className = "projection-note";
    disclaimer.textContent = `Historical data through ${result.historical_data_through || "unavailable"}. Scenario bands are the 20th/50th/80th percentiles of historical analogue outcomes plus a capped news adjustment — scenario estimates, not guaranteed targets. The analogue up-rate is the share of similar past setups that finished higher, not a probability of profit.`;
    panel.appendChild(disclaimer);

    return panel;
  }

  function renderProjectionResult(result, grid) {
    lastProjection = result;
    const candidates = Array.isArray(result.candidates) ? result.candidates : [];
    candidates.forEach((projection) => {
      const card = grid ? grid.querySelector(`[data-projection-symbol="${String(projection.symbol).toUpperCase()}"]`) : null;
      if (!card) return;
      card.querySelectorAll(".projection-panel").forEach((existing) => existing.remove());
      card.appendChild(buildProjectionPanel(projection, result));
    });
    const regime = result.market_regime || {};
    appendAssistantMessage(
      "Trend-News Projection",
      `Projected ${candidates.length} candidates (${result.cached ? "cached result" : "fresh calculation"}). Market regime: ${String(regime.regime || "unavailable").replace(/_/g, "-")} (SPY 20-session ${regime.spy_twenty_session_return_percent !== null && regime.spy_twenty_session_return_percent !== undefined ? `${regime.spy_twenty_session_return_percent}%` : "n/a"}). Projections are historical-analogue scenario bands, not price predictions.`
    );
    const summaryMessage = appendAssistantMessage("Trend-News Projection", formatProjectionChatSummary(result));
    const summaryBody = summaryMessage?.querySelector("div");
    if (summaryBody) summaryBody.style.whiteSpace = "pre-wrap";
    document.querySelectorAll('button[data-role="analyze-top5"]').forEach((analyzeButton) => {
      if (analyzeButton.textContent !== "AI Reviewing...") {
        analyzeButton.textContent = analyzeButtonLabel();
      }
    });
  }

  async function runProjection(button, grid) {
    if (projectionBusy || button.disabled) return;
    if (!isSignedIn()) {
      appendAssistantMessage("Assistant", "Sign in before requesting projections.");
      return;
    }
    projectionBusy = true;
    button.disabled = true;
    button.textContent = "Projecting...";
    const pending = appendAssistantMessage("Trend-News Projection", "Building historical-analogue scenario bands for the top five candidates (daily history, SPY/QQQ/IWM regime, news, and walk-forward backtest)...");
    try {
      const result = await apiFetchJson("/api/market-projection", {
        method: "POST",
        body: JSON.stringify({})
      });
      pending?.remove();
      if (!result?.data || !Array.isArray(result.data.candidates)) {
        throw new Error("The API returned an invalid projection response");
      }
      renderProjectionResult(result.data, grid);
    } catch (error) {
      pending?.remove();
      appendAssistantMessage("Trend-News Projection", `Projection unavailable: ${error.message}`);
    } finally {
      projectionBusy = false;
      button.disabled = false;
      button.textContent = "Project Top 5";
    }
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
    const hasProjection = Boolean(lastProjection);
    const promptLines = [
      "Analyze the top five candidates from the server-generated full-market scan attached under market_scan in the dashboard context.",
      "Each candidate is a complete backend-enriched object: historical scan scores, live snapshot, intraday 5-minute technicals (VWAP, opening range, swing levels, momentum, confirmation/invalidation/targets), news, and — for the final two — a filtered options chain with deterministic backend option scores.",
      "All scores are deterministic backend calculations; do not recalculate or alter them.",
      "Use only the supplied fields. Never invent prices, levels, premiums, Greeks, or news. Explicitly call out anything marked unavailable.",
      "Compare the candidates, identify the strongest current setup or state that none is valid, and explain what data supports or is missing from that conclusion."
    ];
    if (hasProjection) {
      promptLines.push(
        "The server's cached trend-news projections are attached under market_projection. Compare and explain all five cached projections.",
        "For each projected symbol list: bias, confidence, 1-day, 5-day, and 20-day bear/base/bull bands, historical analogue up-rate, news effect, backtest quality, and main risks.",
        "Use the exact projection numbers supplied. Do not alter or recalculate them, and never call the bands guaranteed price targets."
      );
    }
    const prompt = promptLines.join("\n").slice(0, 1_950);

    appendAssistantMessage(
      "You",
      hasProjection
        ? "Analyze the top five enriched scanner candidates and explain their cached trend-news projections."
        : "Analyze the top five enriched full-market scanner candidates."
    );
    const pending = appendAssistantMessage("Assistant", "Reviewing the enriched scanner candidates (live snapshots, intraday levels, news, and option chains)...");

    try {
      const result = await apiFetchJson("/api/assistant/chat", {
        method: "POST",
        body: JSON.stringify({
          message: prompt,
          symbols: candidates.map((candidate) => candidate.symbol).filter(Boolean),
          history: [],
          include_market_scan: true,
          include_market_projection: hasProjection,
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
      button.textContent = analyzeButtonLabel();
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

  // --------------------------------------------------------------------
  // Project Any Ticker (V1) — direct-ticker projections for 1-5 symbols.
  // --------------------------------------------------------------------
  const TICKER_SYMBOL_PATTERN = /^[A-Z]{1,6}(?:[.-][A-Z0-9]{1,4})?$/;
  const MAX_PROJECTION_SYMBOLS = 5;
  let tickerProjectionBusy = false;
  let lastTickerProjectionKey = null;

  function parseTickerInput(raw) {
    const tokens = String(raw || "").split(/[\s,;]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
    const symbols = [];
    for (const token of tokens) {
      if (!TICKER_SYMBOL_PATTERN.test(token)) {
        return { ok: false, symbols: [], error: `"${token.slice(0, 30)}" is not a valid ticker symbol.` };
      }
      if (!symbols.includes(token)) symbols.push(token);
    }
    if (!symbols.length) return { ok: false, symbols: [], error: "Enter one to five ticker symbols (for example: SSPC or SSPC, AAPL)." };
    if (symbols.length > MAX_PROJECTION_SYMBOLS) {
      return { ok: false, symbols: [], error: `A maximum of ${MAX_PROJECTION_SYMBOLS} tickers per request is supported (got ${symbols.length}).` };
    }
    return { ok: true, symbols, error: null };
  }

  // Mirrors the server's deterministic projection-intent detection
  // (api-server src/lib/projectionIntent.ts) — keep the two in sync.
  const PROJECTION_PHRASES = [
    "project", "projection", "forecast", "price target", "price prediction", "predict",
    "outlook", "next week", "next month", "next day", "tomorrow", "coming week",
    "coming month", "coming days", "next few days", "next 5 days", "next five days",
    "next 20 days", "where will", "where is it headed", "where it's headed", "where its headed",
    "how high", "how low", "upside", "downside", "expected move", "scenario",
    "bear case", "bull case", "base case"
  ];
  const UPPERCASE_STOPWORDS = new Set([
    "A", "I", "AI", "AM", "AN", "AND", "ARE", "AS", "AT", "BE", "BUT", "BUY", "CAN", "CEO", "CFO",
    "DO", "DOES", "EPS", "ETF", "ETFS", "FAQ", "FOR", "FROM", "GDP", "GO", "HAS", "HOW", "IF", "IN",
    "IPO", "IRA", "IS", "IT", "ITS", "LLC", "LOW", "ME", "MY", "NEW", "NO", "NOT", "NOW", "OF", "OK",
    "ON", "OR", "P/E", "PE", "PM", "SEC", "SELL", "SO", "THE", "TO", "UP", "US", "USA", "USD", "VS",
    "WEEK", "WHAT", "WHEN", "WHO", "WHY", "WILL", "YOY", "YTD"
  ]);

  function detectProjectionIntent(message, knownSymbols) {
    const text = String(message || "");
    const lower = text.toLowerCase();
    if (!PROJECTION_PHRASES.some((phrase) => lower.includes(phrase))) {
      return { intent: false, symbols: [] };
    }
    const known = new Set((Array.isArray(knownSymbols) ? knownSymbols : [])
      .map((s) => String(s || "").trim().toUpperCase())
      .filter((s) => TICKER_SYMBOL_PATTERN.test(s)));
    const symbols = [];
    const add = (raw) => {
      const symbol = String(raw).toUpperCase();
      if (!TICKER_SYMBOL_PATTERN.test(symbol)) return;
      if (!symbols.includes(symbol)) symbols.push(symbol);
    };
    for (const match of text.matchAll(/\$([A-Za-z]{1,6}(?:[.-][A-Za-z0-9]{1,4})?)\b/g)) add(match[1]);
    for (const match of text.matchAll(/\b([A-Z]{1,6}(?:[.-][A-Z0-9]{1,4})?)\b/g)) {
      const token = match[1];
      if (UPPERCASE_STOPWORDS.has(token)) continue;
      if (token.length === 1 && !known.has(token)) continue;
      add(token);
    }
    if (known.size) {
      for (const match of text.matchAll(/\b([A-Za-z]{1,6}(?:[.-][A-Za-z0-9]{1,4})?)\b/g)) {
        const token = match[1].toUpperCase();
        if (known.has(token)) add(token);
      }
    }
    const limited = symbols.slice(0, MAX_PROJECTION_SYMBOLS);
    return { intent: limited.length > 0, symbols: limited };
  }

  function renderTickerProjectionResult(result) {
    const candidates = Array.isArray(result.candidates) ? result.candidates : [];
    const key = `${result.generated_at || ""}|${candidates.map((c) => c.symbol).join(",")}`;
    if (key === lastTickerProjectionKey && result.cached) {
      appendAssistantMessage(
        "Ticker Projection",
        `Same cached projection for ${candidates.map((c) => c.symbol).join(", ")} (generated ${result.generated_at ? new Date(result.generated_at).toLocaleTimeString() : "earlier"}) — see the cards above. The server recomputes every 15 minutes.`
      );
      return;
    }
    lastTickerProjectionKey = key;

    const regime = result.market_regime || {};
    appendAssistantMessage(
      "Ticker Projection",
      `Projected ${candidates.length} requested ticker${candidates.length === 1 ? "" : "s"} (${result.cached ? "cached result" : "fresh calculation"}; order shown is your request order, not a market ranking). Market regime: ${String(regime.regime || "unavailable").replace(/_/g, "-")}. Projections are historical-analogue scenario bands, not price predictions.`
    );

    const message = appendAssistantMessage("Ticker Projection", "");
    const body = message?.querySelector("div");
    if (body) {
      body.textContent = "";
      candidates.forEach((projection) => {
        const card = document.createElement("div");
        card.className = "scan-card";
        card.style.marginBottom = "10px";
        const header = document.createElement("header");
        const title = document.createElement("strong");
        title.textContent = `${projection.symbol} — requested #${projection.rank}`;
        header.appendChild(title);
        card.appendChild(header);
        card.appendChild(buildProjectionPanel(projection, result));
        body.appendChild(card);
      });
    }
    const summaryMessage = appendAssistantMessage("Ticker Projection", formatProjectionChatSummary(result));
    const summaryBody = summaryMessage?.querySelector("div");
    if (summaryBody) summaryBody.style.whiteSpace = "pre-wrap";
  }

  async function runTickerProjection(button, input) {
    if (tickerProjectionBusy) return;
    openAssistantSection();
    if (!isSignedIn()) {
      appendAssistantMessage("Ticker Projection", "Sign in to project tickers (owner-only).");
      return;
    }
    const parsed = parseTickerInput(input?.value);
    if (!parsed.ok) {
      appendAssistantMessage("Ticker Projection", parsed.error);
      return;
    }
    tickerProjectionBusy = true;
    button.disabled = true;
    button.textContent = "Projecting...";
    const pending = appendAssistantMessage(
      "Ticker Projection",
      `Building historical-analogue scenario bands for ${parsed.symbols.join(", ")} (server-side quotes, daily history, SPY/QQQ/IWM regime, news, walk-forward backtest)...`
    );
    try {
      const result = await apiFetchJson("/api/ticker-projection", {
        method: "POST",
        body: JSON.stringify({ symbols: parsed.symbols })
      });
      pending?.remove();
      if (!result?.data || !Array.isArray(result.data.candidates)) {
        throw new Error("The API returned an invalid ticker-projection response");
      }
      renderTickerProjectionResult(result.data);
    } catch (error) {
      pending?.remove();
      appendAssistantMessage("Ticker Projection", `Ticker projection unavailable: ${error.message}`);
    } finally {
      tickerProjectionBusy = false;
      button.disabled = false;
      button.textContent = "Project Ticker(s)";
    }
  }

  function installTickerProjection(quickActions) {
    if (document.getElementById("tickerProjectionInput")) return;
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexWrap = "wrap";
    wrap.style.gap = "8px";
    wrap.style.alignItems = "center";
    wrap.style.width = "100%";

    const label = document.createElement("strong");
    label.textContent = "Project Any Ticker";
    label.style.fontSize = "12px";
    label.style.textTransform = "uppercase";
    label.style.opacity = ".7";
    label.style.width = "100%";

    const input = document.createElement("input");
    input.id = "tickerProjectionInput";
    input.type = "text";
    input.maxLength = 60;
    input.placeholder = "SSPC or SSPC, AAPL (up to 5)";
    input.setAttribute("aria-label", "Ticker symbols to project (up to five, comma separated)");
    input.style.flex = "1 1 180px";
    input.style.border = "1px solid var(--border)";
    input.style.borderRadius = "10px";
    input.style.padding = "9px 12px";
    input.style.font = "inherit";

    const button = document.createElement("button");
    button.id = "projectTickerBtn";
    button.type = "button";
    button.textContent = "Project Ticker(s)";
    button.addEventListener("click", () => runTickerProjection(button, input));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        runTickerProjection(button, input);
      }
    });

    wrap.append(label, input, button);
    quickActions.appendChild(wrap);
  }

  // Shared hooks so the chat flow (ai-assistant-core.js) can reuse the same
  // deterministic detection and card rendering.
  globalThis.__anyTickerProjection = {
    detectProjectionIntent,
    renderTickerProjectionResult,
    resetRenderState() {
      lastTickerProjectionKey = null;
    }
  };

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

    installTickerProjection(quickActions);

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

  // Section switching is handled by the shared delegated navigation in
  // script.js (activateDashboardSection). This listener only adds the
  // assistant-specific focus behavior and never calls preventDefault.
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.('.nav-btn[data-section="assistant"]');
    if (!button) return;
    if (typeof globalThis.activateDashboardSection !== "function") {
      openAssistantSection();
    }
    document.getElementById("assistantInput")?.focus();
  });

  loadScript("dashboardRuntimeFixesLoader", "dashboard-runtime-fixes.js?v=1.0");
  loadScript("dashboardPolishLoader", "ui-polish.js?v=3.0");
  loadScript("assistantCoreLoader", "ai-assistant-core.js?v=1.2");
  installMarketScanner();
})();