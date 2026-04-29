# Cross-Location Impact Map (Preparation Only)

## Scope
- Branch: `feature/cross-location-support`
- Purpose: map exact same-location assumptions before implementing true cross-location support.
- This file does not change runtime behavior.

## Current Same-Location Assumption
- The system stores one depot field (`location`) per quote row.
- Scraper sets `LocationFrom` and `LocationTo` to the same depot.
- API grouping/filtering partitions by one `location` key.
- Dashboard state/filtering uses one shared location selector.

## Impact Points by Layer

### Scraper input/query flow
- `apps/scraper-service/src/types.ts`
- `ScrapeRequest.locations: DepotCode[]` assumes one depot list for same-location runs.
- `PriceRow.location` stores one depot only.
- `apps/scraper-service/src/scraper.ts`
- `fillBookingWidget(...)` sets:
- `Parameters.LocationFrom` from `pickupLabel`
- `Parameters.LocationTo` from the same `pickupLabel`
- `runAutomatedScrape(...)` loops `for (const depot of request.locations)` and passes `depot` to both pickup/dropoff paths.
- `collectCurrentPageRows(...)` persists only `location: depot`.

### SQLite schema
- `apps/api/src/db.js`
- `pricing_data` table uses single `location TEXT` column.
- `apps/scraper-service/src/storage.ts`
- local schema mirror in `openPricingDb()` also uses single `location TEXT`.
- CSV schema also uses single `location` column (`csvColumns`).

### API routes and query layer
- `apps/api/src/import-db.js`
- CSV import maps one `row.location` field to DB.
- `apps/api/src/server.js`
- `/api/prices/latest` partition/group keys include one `location`.
- `/api/prices/latest` join predicate includes `n.location = latest.location`.
- `/api/trends` `allowedFilters = ["vehicle", "location"]`.
- `/api/trends` selected columns return one `location`.

### Dashboard filters/state
- `apps/dashboard/src/App.js`
- `locationOptions` provides one depot dimension.
- App state uses `const [location, setLocation] = useState("")`.
- Both main and trend pipelines filter with `if (location && row.location !== location) return;`.
- Scraper trigger payload sends `locations: locationsToRun` (same-location batch model).

### Recommendation logic
- `apps/dashboard/src/App.js`
- `buildCompetitorQuoteSnapshot(...)` filters by one `selectedLocation`.
- `buildExactTripMetrics(...)` and `filterExactTripRows(...)` match one `selectedLocation`.
- Baseline recommendation (`getBaselinePrice`) assumes candidate pools already filtered by one location dimension.

### Trend grouping logic
- `apps/dashboard/src/App.js`
- `groupRelevantRows(...)` groups by `dateKey` only after upstream single-location filter.
- This relies on one location filter in calling effects rather than grouping by route pair.

### Latest snapshot logic
- `apps/dashboard/src/App.js`
- `selectLatestRowsBySnapshot(...)` dedupe key includes one `row.location`.
- This conflates pickup/dropoff depot into one dimension.

### Vehicle comparison logic
- `apps/dashboard/src/App.js`
- `getMappedCompetitors(...)` and competitor matching are vehicle-focused.
- Route context currently comes from one location filter (`selectedLocation`), not depot pair.

## Required Future Model Changes (Implementation Step)
- Replace `location` with:
- `pickup_location`
- `dropoff_location`
- Apply this to:
- scraper request/row types
- scraper form automation and row capture
- DB schema + migration path
- API query keys and filter contract
- dashboard state and filters
- dashboard grouping/snapshot/recommendation selectors
- tests and fixtures

## Safe Migration Order (Recommended)
1. Add schema support for `pickup_location` + `dropoff_location` while preserving read compatibility.
2. Update scraper row writes and import pipeline to emit both columns.
3. Update API query layer/grouping to partition by both columns.
4. Update dashboard state to independent pickup/dropoff depot filters.
5. Update recommendation, trend, and latest snapshot selectors to use depot pairs.
6. Extend regression tests with cross-location cases while preserving same-location baselines.

## Baseline Tests to Keep Green During Migration
- `apps/api/tests/prices.test.ts`
- `apps/api/tests/recommendation.test.ts`
- `apps/dashboard/tests/dashboard.spec.ts`

## Notes
- Current behavior must remain stable for:
- Auckland -> Auckland
- Christchurch -> Christchurch
- No partial cross-location logic should be shipped without end-to-end key alignment.
