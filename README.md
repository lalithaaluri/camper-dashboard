# Camper Dashboard Workspace

This repository now uses `pnpm` workspaces with two apps:

- `apps/dashboard`: the React pricing dashboard
- `apps/scraper-service`: the standalone TypeScript + Playwright scraper API

## Quick start

```bash
pnpm install
pnpm --filter scraper-service exec playwright install chromium
pnpm dev:scraper
pnpm dev:dashboard
```

## Scraper service

The scraper service runs on `http://localhost:4301` by default and exposes:

- `GET /api/health`
- `GET /api/runs`
- `POST /api/runs`

It stores run history under `apps/scraper-service/data` and writes the merged
dataset back to:

- `apps/scraper-service/data/dataset_FINAL_SAFE.csv`
- `apps/dashboard/public/dataset_FINAL_SAFE.csv`

## Dashboard integration

The dashboard reads its CSV from `apps/dashboard/public/dataset_FINAL_SAFE.csv`
and calls the scraper service through `REACT_APP_SCRAPER_API_URL`. If that
environment variable is not set, it defaults to `http://localhost:4301`.
