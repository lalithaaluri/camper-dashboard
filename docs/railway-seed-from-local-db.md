# Seed Railway From Local SQLite

Use this when Railway API is empty but your local app already has useful historical data.

## What this does

- Reads rows from your local SQLite database
- Sends them to Railway API using the existing protected ingest endpoint
- Keeps the same architecture:
  - scraper inserts rows
  - API stores rows in SQLite
  - dashboard reads from API

## Command

```bash
node tools/seed-railway-from-local-sqlite.mjs --api-url https://api-production-23653.up.railway.app --token YOUR_INTERNAL_INGEST_TOKEN
```

## Railway persistence prerequisite

Before seeding, make sure API service is writing SQLite to the mounted volume:

- Attach Railway Volume to API service at `/app/data`
- Set API env var `PRICING_DB_PATH=/app/data/pricing.db`

If this is not set first, seeded rows can be lost on the next restart.

## Optional arguments

- `--db-path C:\\full\\path\\to\\pricing.db`
- `--batch-size 500`

If `--db-path` is omitted, the script uses:

```text
apps/api/data/pricing.db
```

## Important

- The token must be the same value as Railway API variable `INTERNAL_INGEST_TOKEN`.
- This does not depend on the VM.
- Run this one time to seed Railway with your old history.
- After that, Railway scraper can keep adding new rows.
