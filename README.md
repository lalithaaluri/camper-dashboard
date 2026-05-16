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

## Ubuntu VM access from host machine

When opening the dashboard from your host browser via VM IP (for example
`http://192.168.x.x:3000`), start services with host binding enabled:

```bash
HOST=0.0.0.0 pnpm --filter api dev
HOST=0.0.0.0 pnpm dev:scraper
HOST=0.0.0.0 pnpm dev:dashboard
```

Then open:

- `http://<vm-ip>:3000` (dashboard)
- `http://<vm-ip>:4302/api/health` (pricing API)
- `http://<vm-ip>:4301/api/health` (scraper service)

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

## Optional secure dashboard login (recommended for hosted)

Dashboard auth is handled by the API service (not the frontend bundle).

Set these API environment variables:

- `DASHBOARD_AUTH_USER=<username>`
- `DASHBOARD_AUTH_PASSWORD_HASH=<scrypt hash>`
- `DASHBOARD_SESSION_SECRET=<random secret>`
- `ALLOWED_ORIGINS=<dashboard URL>`

Generate hash + session secret:

```bash
node tools/generate-dashboard-auth.mjs "<password>"
```
