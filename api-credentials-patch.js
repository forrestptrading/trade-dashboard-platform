/* GitHub Pages runs on a different origin than the hosted API.
   Override the shared JSON helper so authenticated requests include session cookies. */
async function apiFetchJson(path, options = {}) {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const result = await response.json().catch(() => null);

  if (!response.ok || !result) {
    throw new Error(result?.error || `Request failed with ${response.status}`);
  }

  return result;
}
