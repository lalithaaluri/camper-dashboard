## Plan B Deployment (Netlify + Railway)

### Goal
- Dashboard on Netlify
- API on Railway
- Scraper on Railway
- Local VM untouched

### Important
- `Netlify Password Protection` is not available on Netlify Free for production deploys.
- If you must stay free, use:
  - strong random URLs during setup, and
  - API/scraper token protection (already added for ingest path).

## 1) Deploy API (Railway)

1. Railway -> New Project -> Deploy from GitHub.
2. Select this repo.
3. Create service **api** from repo root with:
   - Root Directory: `apps/api`
   - Start Command: `npm start`
4. Variables:
   - `HOST=0.0.0.0`
   - `PORT=4302` (optional; Railway usually injects `PORT`)
   - `INTERNAL_INGEST_TOKEN=<long-random-token>`
5. Deploy and copy API public URL, for example:
   - `https://api-production-xxxx.up.railway.app`

## 2) Deploy Scraper (Railway)

1. In same Railway project, add new service from same repo.
2. Create service **scraper-service**:
   - Root Directory: `apps/scraper-service`
   - Start Command: `npm run dev` (or preferred production command if configured)
3. Variables:
   - `HOST=0.0.0.0`
   - `PORT=4301` (optional)
   - `PRICING_API_BASE_URL=<API URL from step 1>`
   - `INTERNAL_INGEST_TOKEN=<same token as API>`
   - `SCRAPER_WRITE_CSV_BACKUP=false`
4. Deploy and copy scraper URL, for example:
   - `https://scraper-service-production-xxxx.up.railway.app`

## 3) Deploy Dashboard (Netlify)

1. Netlify -> Add new site -> Import from GitHub.
2. Select this repo.
3. Build settings:
   - Base directory: `apps/dashboard`
   - Build command: `npm run build`
   - Publish directory: `build`
4. Environment variables:
   - `REACT_APP_PRICING_API_URL=<API URL>/api`
   - `REACT_APP_SCRAPER_API_URL=<Scraper URL>`
5. Deploy and copy dashboard URL:
   - `https://<site-name>.netlify.app`

## 4) Smoke test

1. Open dashboard URL.
2. Check browser console has no CORS/API URL errors.
3. Open:
   - `<API URL>/api/health`
   - `<Scraper URL>/api/health`
4. Trigger one scrape from dashboard and confirm:
   - run starts
   - completes
   - new rows visible in quote table

## 5) Security notes

- API ingest endpoint is now token-protected:
  - `POST /api/internal/ingest-rows`
  - Requires header: `x-internal-token`
- In cloud mode, scraper sends rows to API via this endpoint when:
  - `PRICING_API_BASE_URL` is set.
- Local/VM mode still works as before when `PRICING_API_BASE_URL` is not set.

