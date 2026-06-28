# Trade Dashboard Platform

A personal trading dashboard for account monitoring, portfolio analytics, options tracking, watchlist management, and AI-powered risk analysis. The current GitHub Pages site is a static dashboard shell that talks to the hosted Replit API when it is available and keeps local-only data in browser storage.

## Current app structure

- `index.html` — GitHub Pages entry point for `https://forrestptrading.github.io/trade-dashboard-platform/`.
- `style.css` — styles for the static dashboard UI.
- `script.js` — browser-side dashboard behavior, API calls, local storage, and rendering.
- `artifacts/trading-dashboard/` — React/Vite dashboard workstream retained in the monorepo, but not deployed by the current Pages workflow.
- `artifacts/api-server/` — Express API server workstream for Replit/server deployment.
- `lib/` — shared API, client, validation, and database packages.

## GitHub Pages deployment

The `.github/workflows/pages.yml` workflow deploys the root static dashboard files (`index.html`, `style.css`, and `script.js`) and includes a `404.html` fallback copied from `index.html`. The static HTML sets the GitHub Pages base path so fallback pages continue to load the root assets under `/trade-dashboard-platform/`.

## Local checks

```bash
pnpm run typecheck
BASE_PATH=/trade-dashboard-platform/ pnpm --filter @workspace/trading-dashboard run build
mkdir -p /tmp/tdp-site/trade-dashboard-platform
cp index.html style.css script.js /tmp/tdp-site/trade-dashboard-platform/
python3 -m http.server 4173 --directory /tmp/tdp-site
```
