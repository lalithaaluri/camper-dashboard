import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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
  runsFile: path.join(appDir, "data", "runs.json"),
  datasetFile: path.join(appDir, "data", "dataset_FINAL_SAFE.csv"),
  dashboardDatasetFile: path.join(workspaceRoot, "apps", "dashboard", "public", "dataset_FINAL_SAFE.csv")
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

export const loadDataset = async () => {
  for (const candidate of [paths.datasetFile, paths.dashboardDatasetFile]) {
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
  const keyed = new Map<string, PriceRow>();

  [...existingRows, ...freshRows].forEach((row) => {
    const key = [
      row.pickup_date,
      row.dropoff_date,
      row.location,
      row.company,
      row.vehicle,
      row.price,
      row.scrape_date,
      row.type
    ].join("|");
    keyed.set(key, row);
  });

  return Array.from(keyed.values()).sort((left, right) =>
    [
      left.pickup_date,
      left.dropoff_date,
      left.location,
      left.company,
      left.vehicle
    ]
      .join("|")
      .localeCompare(
        [
          right.pickup_date,
          right.dropoff_date,
          right.location,
          right.company,
          right.vehicle
        ].join("|")
      )
  );
};

export const writeDataset = async (rows: PriceRow[]) => {
  const csv = stringify(rows, {
    header: true,
    columns: csvColumns
  });

  await writeFile(paths.datasetFile, csv, "utf8");
  await writeFile(paths.dashboardDatasetFile, csv, "utf8");
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
