import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { stringify } from "csv-stringify/sync";
import type { DatasetSummary, PriceRow, RunSummary } from "./types.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(currentDir, "..");
const workspaceRoot = path.resolve(appDir, "..", "..");

export const paths = {
  appDir,
  workspaceRoot,
  dataDir: path.join(appDir, "data"),
  artifactsDir: path.join(appDir, "artifacts"),
  apiDbDir: path.join(workspaceRoot, "apps", "api", "data"),
  apiPricingDbFile: path.join(workspaceRoot, "apps", "api", "data", "pricing.db"),
  runsFile: path.join(appDir, "data", "runs.json"),
  datasetFile: path.join(appDir, "data", "dataset_FINAL_SAFE.csv"),
  dashboardDatasetFile: path.join(workspaceRoot, "apps", "dashboard", "public", "dataset_FINAL_SAFE.csv"),
  buildDatasetFile: path.join(workspaceRoot, "apps", "dashboard", "build", "dataset_FINAL_SAFE.csv")
};

const csvColumns: Array<keyof PriceRow> = [
  "pickup_date",
  "dropoff_date",
  "location",
  "company",
  "vehicle",
  "price",
  "scrape_date",
  "type"
];

const csvEscape = (value: string) => value.replace(/^"(.*)"$/, "$1");

const normalizeDate = (value: string) => {
  const trimmed = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parts = trimmed.split("/");
  if (parts.length === 3) {
    const [month, day, year] = parts;
    return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return trimmed;
};

export const ensureStorage = async () => {
  await mkdir(paths.dataDir, { recursive: true });
  await mkdir(paths.artifactsDir, { recursive: true });
  await mkdir(paths.apiDbDir, { recursive: true });
};

export const loadRunHistory = async () => {
  try {
    const raw = await readFile(paths.runsFile, "utf8");
    return JSON.parse(raw) as RunSummary[];
  } catch {
    return [];
  }
};

export const saveRunHistory = async (runs: RunSummary[]) => {
  await writeFile(paths.runsFile, `${JSON.stringify(runs, null, 2)}\n`, "utf8");
};

export const upsertRun = async (run: RunSummary) => {
  const existing = await loadRunHistory();
  const nextRuns = [run, ...existing.filter((entry) => entry.id !== run.id)].slice(0, 30);
  await saveRunHistory(nextRuns);
};

const parseCsv = (raw: string): PriceRow[] => {
  const lines = raw.trim().split(/\r?\n/);
  if (lines.length <= 1) {
    return [];
  }

  const rows = lines.slice(1).map((line) => {
    const matches = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)|(?<=,)(?=,)/g) || [];
    const values = matches.map((part) => csvEscape(part.trim())).filter((entry) => entry !== "");
    const mapped = Object.fromEntries(csvColumns.map((column, index) => [column, values[index] ?? ""]));

    const type: PriceRow["type"] =
      mapped.type.trim().toLowerCase() === "elements" ? "elements" : "competitor";

    return {
      pickup_date: normalizeDate(mapped.pickup_date),
      dropoff_date: normalizeDate(mapped.dropoff_date),
      location: mapped.location.trim().toLowerCase() as PriceRow["location"],
      company: mapped.company.trim().toLowerCase(),
      vehicle: mapped.vehicle.trim().toLowerCase(),
      price: Number(mapped.price),
      scrape_date: normalizeDate(mapped.scrape_date),
      type
    };
  });

  return rows.filter((row) => row.pickup_date && Number.isFinite(row.price));
};

const openPricingDb = () => {
  const db = new DatabaseSync(paths.apiPricingDbFile);
  db.exec(`
    CREATE TABLE IF NOT EXISTS pricing_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pickup_date TEXT,
      dropoff_date TEXT,
      location TEXT,
      company TEXT,
      vehicle TEXT,
      price REAL,
      scrape_date TEXT,
      type TEXT
    );
  `);

  const existingColumns = db
    .prepare(`PRAGMA table_info(pricing_data)`)
    .all() as Array<{ name: string }>;
  const existingColumnNames = new Set(existingColumns.map((column) => column.name));

  if (!existingColumnNames.has("pickup_location")) {
    db.exec(`ALTER TABLE pricing_data ADD COLUMN pickup_location TEXT`);
  }
  if (!existingColumnNames.has("dropoff_location")) {
    db.exec(`ALTER TABLE pricing_data ADD COLUMN dropoff_location TEXT`);
  }

  const indexes = db
    .prepare(
      `
        SELECT name, sql
        FROM sqlite_master
        WHERE type = 'index'
          AND tbl_name = 'pricing_data'
          AND sql IS NOT NULL
      `
    )
    .all() as Array<{ name: string; sql: string }>;

  for (const index of indexes) {
    const sql = String(index.sql || "").toLowerCase();
    const looksLikeLegacyUniqueTripIndex =
      sql.includes("unique") &&
      sql.includes("pickup_date") &&
      sql.includes("dropoff_date") &&
      sql.includes("location") &&
      sql.includes("company") &&
      sql.includes("vehicle") &&
      !sql.includes("scrape_date");

    if (looksLikeLegacyUniqueTripIndex) {
      db.exec(`DROP INDEX IF EXISTS "${index.name}"`);
    }
  }

  return db;
};

export const insertPricingRows = async (rows: PriceRow[]) => {
  if (!rows.length) {
    return 0;
  }

  const db = openPricingDb();
  const insert = db.prepare(`
    INSERT INTO pricing_data (
      pickup_date,
      dropoff_date,
      location,
      pickup_location,
      dropoff_location,
      company,
      vehicle,
      price,
      scrape_date,
      type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `);
  let inserted = 0;

  db.exec("BEGIN");
  try {
    for (const row of rows) {
      insert.run(
        row.pickup_date,
        row.dropoff_date,
        row.location,
        row.pickup_location ?? row.location,
        row.dropoff_location ?? row.location,
        row.company,
        row.vehicle,
        row.price,
        row.scrape_date,
        row.type
      );
      inserted += 1;
    }
    db.exec("COMMIT");
    return inserted;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
};

export const getPricingDataRowCount = async () => {
  const db = openPricingDb();
  try {
    const result = db
      .prepare(
        `
          SELECT COUNT(*) AS total
          FROM pricing_data
        `
      )
      .get() as { total?: number };

    return Number(result?.total ?? 0);
  } finally {
    db.close();
  }
};

export const deleteBadTrekScrapeBatch = async () => {
  const db = openPricingDb();
  try {
    const result = db
      .prepare(`
        DELETE FROM pricing_data
        WHERE scrape_date = '2026-04-23'
        AND vehicle LIKE 'trek%'
      `)
      .run();

    console.log("Deleted Trek rows from bad batch:", result.changes);
    return result.changes;
  } finally {
    db.close();
  }
};

export const deleteInvalidCompetitorRows = async () => {
  const db = openPricingDb();
  try {
    const result = db
      .prepare(`
        DELETE FROM pricing_data
        WHERE type = 'competitor'
          AND (
            price IS NULL
            OR CAST(price AS REAL) <= 10
          )
      `)
      .run();

    console.log("Deleted invalid competitor rows:", result.changes);
    return result.changes;
  } finally {
    db.close();
  }
};

const loadDatasetFromDb = async (): Promise<PriceRow[]> => {
  const db = openPricingDb();

  try {
    const rows = db
      .prepare(
        `
          SELECT
            pickup_date,
            dropoff_date,
            location,
            pickup_location,
            dropoff_location,
            company,
            vehicle,
            price,
            scrape_date,
            type
          FROM pricing_data
        `
      )
      .all() as Array<{
      pickup_date: string;
      dropoff_date: string;
      location: string;
      pickup_location?: string | null;
      dropoff_location?: string | null;
      company: string;
      vehicle: string;
      price: number;
      scrape_date: string;
      type: string;
    }>;

    return rows.map((row): PriceRow => {
      const normalizedType: PriceRow["type"] =
        String(row.type ?? "").trim().toLowerCase() === "elements" ? "elements" : "competitor";

      return {
        pickup_date: normalizeDate(String(row.pickup_date ?? "")),
        dropoff_date: normalizeDate(String(row.dropoff_date ?? "")),
        pickup_location: String(
          row.pickup_location ?? row.location ?? ""
        ).trim().toLowerCase() as PriceRow["pickup_location"],
        dropoff_location: String(
          row.dropoff_location ?? row.location ?? ""
        ).trim().toLowerCase() as PriceRow["dropoff_location"],
        location: String(row.location ?? "").trim().toLowerCase() as PriceRow["location"],
        company: String(row.company ?? "").trim().toLowerCase(),
        vehicle: String(row.vehicle ?? "").trim().toLowerCase(),
        price: Number(row.price),
        scrape_date: normalizeDate(String(row.scrape_date ?? "")),
        type: normalizedType
      };
    });
  } finally {
    db.close();
  }
};

export const loadDataset = async () => {
  try {
    return await loadDatasetFromDb();
  } catch {
    // Fall back to CSV if DB access fails.
  }

  for (const candidate of [paths.dashboardDatasetFile, paths.datasetFile]) {
    try {
      const raw = await readFile(candidate, "utf8");
      return parseCsv(raw);
    } catch {
      continue;
    }
  }

  return [] as PriceRow[];
};

export const summarizeDataset = (rows: PriceRow[]): DatasetSummary => ({
  rowCount: rows.length,
  locations: Array.from(new Set(rows.map((row) => row.location))).sort() as DatasetSummary["locations"],
  latestPickupDate: rows.length ? rows.map((row) => row.pickup_date).sort().at(-1) ?? null : null,
  latestScrapeDate: rows.length ? rows.map((row) => row.scrape_date).sort().at(-1) ?? null : null
});

export const mergeRows = (existingRows: PriceRow[], freshRows: PriceRow[]) => {
  return [...existingRows, ...freshRows].sort((left, right) =>
    [
      left.pickup_date,
      left.dropoff_date,
      left.location,
      left.company,
      left.vehicle,
      left.scrape_date
    ]
      .join("|")
      .localeCompare(
        [
          right.pickup_date,
          right.dropoff_date,
          right.location,
          right.company,
          right.vehicle,
          right.scrape_date
        ].join("|")
      )
  );
};

export const writeDataset = async (rows: PriceRow[]) => {
  const csv = stringify(rows, {
    header: true,
    columns: csvColumns
  });

  await writeFile(paths.dashboardDatasetFile, csv, "utf8");
  await writeFile(paths.datasetFile, csv, "utf8");
  try {
    await writeFile(paths.buildDatasetFile, csv, "utf8");
  } catch {
    // The build output is optional in development.
  }
};

export const writeRunArtifact = async (runId: string, rows: PriceRow[], warnings: string[]) => {
  const runDir = path.join(paths.artifactsDir, runId);
  await mkdir(runDir, { recursive: true });

  const csvPath = path.join(runDir, "rows.csv");
  const logPath = path.join(runDir, "warnings.txt");

  await writeFile(
    csvPath,
    stringify(rows, {
      header: true,
      columns: csvColumns
    }),
    "utf8"
  );
  await writeFile(logPath, warnings.join("\n"), "utf8");

  return { csvPath, logPath };
};
