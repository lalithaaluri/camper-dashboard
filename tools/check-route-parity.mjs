#!/usr/bin/env node

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = value;
    index += 1;
  }
  return args;
};

const normalizeUrl = (value) => String(value || "").trim().replace(/\/+$/, "");

const toRowKey = (row) => {
  const type = String(row.type || "").trim().toLowerCase();
  const company = String(row.company || "").trim().toLowerCase();
  const vehicle = String(row.vehicle || "").trim().toLowerCase();
  const pickupDate = String(row.pickup_date || "").trim();
  const dropoffDate = String(row.dropoff_date || "").trim();
  const pickup = String(row.pickup_location || row.location || "").trim().toLowerCase();
  const dropoff = String(row.dropoff_location || row.location || "").trim().toLowerCase();
  return [type, company, vehicle, pickupDate, dropoffDate, pickup, dropoff].join("|");
};

const toNumericOrNull = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const almostEqual = (left, right, epsilon = 1e-6) => {
  if (left === null && right === null) return true;
  if (left === null || right === null) return false;
  return Math.abs(left - right) <= epsilon;
};

const buildEndpoint = ({ baseUrl, pickupLocation, dropoffLocation, maxPickupDates, maxScrapeDates }) => {
  const url = new URL(`${baseUrl}/api/prices/latest`);
  if (pickupLocation) url.searchParams.set("pickup_location", pickupLocation);
  if (dropoffLocation) url.searchParams.set("dropoff_location", dropoffLocation);
  if (maxPickupDates) url.searchParams.set("max_pickup_dates", String(maxPickupDates));
  if (maxScrapeDates) url.searchParams.set("max_scrape_dates", String(maxScrapeDates));
  return url.toString();
};

const fetchRows = async (label, endpoint) => {
  const response = await fetch(endpoint);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${label} request failed (${response.status}): ${body}`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows)) {
    throw new Error(`${label} response is not an array`);
  }
  return rows;
};

const printUsage = () => {
  console.log(`Usage:\n  node tools/check-route-parity.mjs --source-url <url> --target-url <url> [options]\n\nOptions:\n  --pickup-location <value>   Default: auckland\n  --dropoff-location <value>  Default: auckland\n  --pickup-date <YYYY-MM-DD>  Optional filter\n  --dropoff-date <YYYY-MM-DD> Optional filter\n  --max-pickup-dates <n>      Default: 180\n  --max-scrape-dates <n>      Default: 30\n\nExample:\n  node tools/check-route-parity.mjs --source-url http://localhost:4302 --target-url https://api-production-23653.up.railway.app --pickup-location auckland --dropoff-location auckland --pickup-date 2026-06-27 --dropoff-date 2026-06-29`);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printUsage();
    return;
  }

  const sourceUrl = normalizeUrl(args["source-url"]);
  const targetUrl = normalizeUrl(args["target-url"]);

  if (!sourceUrl || !targetUrl) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const pickupLocation = String(args["pickup-location"] || "auckland").trim().toLowerCase();
  const dropoffLocation = String(args["dropoff-location"] || "auckland").trim().toLowerCase();
  const pickupDate = args["pickup-date"] ? String(args["pickup-date"]).trim() : "";
  const dropoffDate = args["dropoff-date"] ? String(args["dropoff-date"]).trim() : "";
  const maxPickupDates = Number.parseInt(String(args["max-pickup-dates"] || "180"), 10);
  const maxScrapeDates = Number.parseInt(String(args["max-scrape-dates"] || "30"), 10);

  const sourceEndpoint = buildEndpoint({
    baseUrl: sourceUrl,
    pickupLocation,
    dropoffLocation,
    maxPickupDates,
    maxScrapeDates
  });
  const targetEndpoint = buildEndpoint({
    baseUrl: targetUrl,
    pickupLocation,
    dropoffLocation,
    maxPickupDates,
    maxScrapeDates
  });

  const [sourceRowsRaw, targetRowsRaw] = await Promise.all([
    fetchRows("source", sourceEndpoint),
    fetchRows("target", targetEndpoint)
  ]);

  const dateFilter = (row) => {
    if (pickupDate && String(row.pickup_date || "").trim() !== pickupDate) return false;
    if (dropoffDate && String(row.dropoff_date || "").trim() !== dropoffDate) return false;
    return true;
  };

  const sourceRows = sourceRowsRaw.filter(dateFilter);
  const targetRows = targetRowsRaw.filter(dateFilter);

  const sourceByKey = new Map(
    sourceRows.map((row) => [
      toRowKey(row),
      {
        price: toNumericOrNull(row.price),
        websiteDailyRate: toNumericOrNull(row.website_daily_rate),
        dailyRate: toNumericOrNull(row.daily_rate),
        type: row.type,
        company: row.company,
        vehicle: row.vehicle,
        pickup_date: row.pickup_date,
        dropoff_date: row.dropoff_date,
        pickup_location: row.pickup_location || row.location,
        dropoff_location: row.dropoff_location || row.location
      }
    ])
  );

  const targetByKey = new Map(
    targetRows.map((row) => [
      toRowKey(row),
      {
        price: toNumericOrNull(row.price),
        websiteDailyRate: toNumericOrNull(row.website_daily_rate),
        dailyRate: toNumericOrNull(row.daily_rate),
        type: row.type,
        company: row.company,
        vehicle: row.vehicle,
        pickup_date: row.pickup_date,
        dropoff_date: row.dropoff_date,
        pickup_location: row.pickup_location || row.location,
        dropoff_location: row.dropoff_location || row.location
      }
    ])
  );

  const allKeys = [...new Set([...sourceByKey.keys(), ...targetByKey.keys()])].sort();
  const mismatches = [];

  for (const key of allKeys) {
    const left = sourceByKey.get(key);
    const right = targetByKey.get(key);

    if (!left || !right) {
      mismatches.push({ key, issue: "missing_row", inSource: Boolean(left), inTarget: Boolean(right) });
      continue;
    }

    const priceMatch = almostEqual(left.price, right.price);
    const websiteDailyMatch = almostEqual(left.websiteDailyRate, right.websiteDailyRate);
    const dailyRateMatch = almostEqual(left.dailyRate, right.dailyRate);

    if (!priceMatch || !websiteDailyMatch || !dailyRateMatch) {
      mismatches.push({
        key,
        issue: "value_mismatch",
        source: left,
        target: right,
        priceMatch,
        websiteDailyMatch,
        dailyRateMatch
      });
    }
  }

  const summary = {
    sourceUrl,
    targetUrl,
    pickupLocation,
    dropoffLocation,
    pickupDate: pickupDate || null,
    dropoffDate: dropoffDate || null,
    sourceRows: sourceRows.length,
    targetRows: targetRows.length,
    mismatchCount: mismatches.length
  };

  console.log(JSON.stringify(summary, null, 2));

  if (mismatches.length > 0) {
    console.log("Mismatches:");
    console.log(JSON.stringify(mismatches, null, 2));
    process.exitCode = 2;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
