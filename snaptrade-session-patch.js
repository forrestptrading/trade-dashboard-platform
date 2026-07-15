/* Bearer-session fallback for browsers that block cross-site cookies. */
const SNAPTRADE_SESSION_STORAGE_KEY = "fp_dashboard_session";
let snapTradeSessionToken = "";

try {
  snapTradeSessionToken = localStorage.getItem(SNAPTRADE_SESSION_STORAGE_KEY) || "";
} catch {
  snapTradeSessionToken = "";
}

function saveSnapTradeSessionToken(token) {
  snapTradeSessionToken = token || "";
  try {
    if (snapTradeSessionToken) {
      localStorage.setItem(SNAPTRADE_SESSION_STORAGE_KEY, snapTradeSessionToken);
    } else {
      localStorage.removeItem(SNAPTRADE_SESSION_STORAGE_KEY);
    }
  } catch (error) {
    console.warn("Dashboard session storage failed:", error);
  }
}

async function apiFetchJson(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (snapTradeSessionToken) {
    headers.Authorization = `Bearer ${snapTradeSessionToken}`;
  }

  const response = await fetch(`${BACKEND_URL}${path}`, {
    credentials: "include",
    ...options,
    headers
  });

  const issuedToken = response.headers.get("X-Session-Token");
  if (issuedToken) saveSnapTradeSessionToken(issuedToken);

  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    throw new Error(result?.error || `Request failed with ${response.status}`);
  }
  return result;
}

async function checkSnapTradeAuth() {
  try {
    const result = await apiFetchJson("/api/auth/me");
    snapTradeUser = result.data?.user || null;
  } catch {
    snapTradeUser = null;
    if (snapTradeSessionToken) saveSnapTradeSessionToken("");
  }
  renderSnapTradeAuth();
}

async function logoutSnapTrade() {
  try {
    await apiFetchJson("/api/snaptrade/logout", {
      method: "POST",
      body: JSON.stringify({})
    });
  } catch (error) {
    console.warn("Dashboard logout failed:", error);
  }

  saveSnapTradeSessionToken("");
  snapTradeUser = null;
  brokerConnections = [];
  livePortfolio = null;
  livePortfolioSource = "mock";
  snapTradeStatus("Signed out. Private brokerage data is hidden.");
  renderSnapTradeAuth();
  renderAccountsList();
  renderBrokerCards();
}
