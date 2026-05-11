const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const { getDb } = require("./db");

const defaultCsvPath = path.join(
  __dirname,
  "..",
  "..",
  "dashboard",
  "public",
  "dataset_FINAL_TrekSAFE.csv"
);

const normalizeString = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  const stringValue = String(value).trim();
  return stringValue === "" ? null : stringValue;
};

const resolveCsvPath = (customCsvPath) => {
  if (customCsvPath && customCsvPath.trim()) {
    return path.resolve(customCsvPath.trim());
  }

  if (process.env.IMPORT_CSV_PATH && process.env.IMPORT_CSV_PATH.trim()) {
    return path.resolve(process.env.IMPORT_CSV_PATH.trim());
  }

  return defaultCsvPath;
};

const importCsvToDb = async (customCsvPath) => {
  const db = getDb();
  const csvPath = resolveCsvPath(customCsvPath);

  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV not found: ${csvPath}`);
  }

  db.prepare("DELETE FROM pricing_data;").run();

  const insertStmt = db.prepare(`
    INSERT INTO pricing_data (
      pickup_date,
      dropoff_date,
      location,
      pickup_location,
      dropoff_location,
      company,
      vehicle,
      price,
      website_daily_rate,
      scrape_date,
      type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `);
  const insertBatch = db.transaction((rows) => {
    for (const row of rows) {
      insertStmt.run(...row);
    }
  });
  let importedRows = 0;
  let skippedRows = 0;
  let pendingRows = [];
  const flushBatch = () => {
    if (!pendingRows.length) {
      return;
    }

    insertBatch(pendingRows);
    pendingRows = [];
  };

  await new Promise((resolve, reject) => {
    const stream = fs
      .createReadStream(csvPath)
      .pipe(csv())
      .on("data", (row) => {
        const pickupDateRaw = row.pickup_date;
        const pickupDate = typeof pickupDateRaw === "string" ? pickupDateRaw.trim() : "";
        const price = Number(row.price);

        if (!pickupDate || !Number.isFinite(price)) {
          skippedRows += 1;
          return;
        }

        pendingRows.push([
          normalizeString(row.pickup_date),
          normalizeString(row.dropoff_date),
          normalizeString(row.location),
          normalizeString(row.pickup_location || row.location),
          normalizeString(row.dropoff_location || row.location),
          normalizeString(row.company),
          normalizeString(row.vehicle),
          price,
          Number.isFinite(Number(row.website_daily_rate))
            ? Number(row.website_daily_rate)
            : null,
          normalizeString(row.scrape_date),
          normalizeString(row.type)
        ]);
        importedRows += 1;

        if (pendingRows.length >= 1000) {
          flushBatch();
        }
      })
      .on("end", () => {
        flushBatch();
        resolve();
      })
      .on("error", reject);

    stream.on("error", reject);
  });

  const result = db.prepare("SELECT COUNT(*) AS total FROM pricing_data;").get();
  console.log(`CSV source: ${csvPath}`);
  console.log(`Total imported rows: ${importedRows}`);
  console.log(`Skipped invalid rows: ${skippedRows}`);
  console.log(`Total row count in pricing_data: ${result.total}`);
};

if (require.main === module) {
  const customCsvPath = process.argv[2] || "";
  importCsvToDb(customCsvPath).catch((error) => {
    console.error("Import failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  importCsvToDb
};
