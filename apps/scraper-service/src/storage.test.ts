import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getPricingDataRowCount,
  insertPricingRows,
  loadDataset,
  mergeRows,
  paths,
  writeDataset
} from "./storage.js";
import type { PriceRow } from "./types.js";

const csvHeader = "pickup_date,dropoff_date,location,company,vehicle,price,scrape_date,type\n";

const toCsv = (rows: string[]) => `${csvHeader}${rows.join("\n")}\n`;

test("loadDataset reads from the shared API SQLite database", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "camper-storage-test-"));
  const originalDashboardDatasetFile = paths.dashboardDatasetFile;
  const originalDatasetFile = paths.datasetFile;
  const originalApiDbDir = paths.apiDbDir;
  const originalApiPricingDbFile = paths.apiPricingDbFile;

  try {
    paths.dashboardDatasetFile = path.join(tempRoot, "dashboard.csv");
    paths.datasetFile = path.join(tempRoot, "service.csv");
    paths.apiDbDir = tempRoot;
    paths.apiPricingDbFile = path.join(tempRoot, "pricing.db");

    await writeFile(
      paths.dashboardDatasetFile,
      toCsv(["2026-04-01,2026-04-02,auckland,elementsworld,tandem,999,2026-04-18,elements"]),
      "utf8"
    );
    await writeFile(
      paths.datasetFile,
      toCsv(["2026-04-03,2026-04-04,christchurch,mighty,deuce,888,2026-04-18,competitor"]),
      "utf8"
    );

    await insertPricingRows([
      {
        pickup_date: "2026-04-01",
        dropoff_date: "2026-04-02",
        location: "auckland",
        company: "elementsworld",
        vehicle: "tandem",
        price: 111,
        scrape_date: "2026-04-18",
        type: "elements"
      }
    ]);

    const rows = await loadDataset();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.pickup_date, "2026-04-01");
    assert.equal(rows[0]?.price, 111);
  } finally {
    paths.dashboardDatasetFile = originalDashboardDatasetFile;
    paths.datasetFile = originalDatasetFile;
    paths.apiDbDir = originalApiDbDir;
    paths.apiPricingDbFile = originalApiPricingDbFile;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("writeDataset keeps the service cache in sync with the dashboard master CSV", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "camper-storage-write-test-"));
  const originalDashboardDatasetFile = paths.dashboardDatasetFile;
  const originalDatasetFile = paths.datasetFile;
  const originalBuildDatasetFile = paths.buildDatasetFile;

  try {
    paths.dashboardDatasetFile = path.join(tempRoot, "dashboard.csv");
    paths.datasetFile = path.join(tempRoot, "service.csv");
    paths.buildDatasetFile = path.join(tempRoot, "build", "dataset_FINAL_SAFE.csv");

    const rows: PriceRow[] = [
      {
        pickup_date: "2026-04-01",
        dropoff_date: "2026-04-02",
        location: "auckland",
        company: "elementsworld",
        vehicle: "tandem",
        price: 111,
        scrape_date: "2026-04-18",
        type: "elements"
      }
    ];

    await writeDataset(rows);

    const dashboardCsv = await readFile(paths.dashboardDatasetFile, "utf8");
    const serviceCsv = await readFile(paths.datasetFile, "utf8");

    assert.equal(serviceCsv, dashboardCsv);
  } finally {
    paths.dashboardDatasetFile = originalDashboardDatasetFile;
    paths.datasetFile = originalDatasetFile;
    paths.buildDatasetFile = originalBuildDatasetFile;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("mergeRows appends fresh rows for historical tracking", () => {
  const existingRows: PriceRow[] = [
    {
      pickup_date: "2026-04-01",
      dropoff_date: "2026-04-02",
      location: "auckland",
      company: "elementsworld",
      vehicle: "tandem",
      price: 111,
      scrape_date: "2026-04-17",
      type: "elements"
    }
  ];
  const freshRows: PriceRow[] = [
    {
      pickup_date: "2026-04-01",
      dropoff_date: "2026-04-02",
      location: "auckland",
      company: "elementsworld",
      vehicle: "tandem",
      price: 119,
      scrape_date: "2026-04-18",
      type: "elements"
    }
  ];

  const merged = mergeRows(existingRows, freshRows);

  assert.equal(merged.length, 2);
  assert.deepEqual(
    merged.map((row) => ({ price: row.price, scrape_date: row.scrape_date })),
    [
      { price: 111, scrape_date: "2026-04-17" },
      { price: 119, scrape_date: "2026-04-18" }
    ]
  );
});

test("insertPricingRows preserves historical rows across different scrape_date values", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "camper-storage-history-test-"));
  const originalApiDbDir = paths.apiDbDir;
  const originalApiPricingDbFile = paths.apiPricingDbFile;

  try {
    paths.apiDbDir = tempRoot;
    paths.apiPricingDbFile = path.join(tempRoot, "pricing.db");

    const rowBase: Omit<PriceRow, "scrape_date" | "price"> = {
      pickup_date: "2026-06-01",
      dropoff_date: "2026-06-02",
      location: "auckland",
      company: "elementsworld",
      vehicle: "trek budget",
      type: "elements"
    };

    const firstInsert = await insertPricingRows([
      {
        ...rowBase,
        price: 100,
        scrape_date: "2026-04-23"
      }
    ]);
    const secondInsert = await insertPricingRows([
      {
        ...rowBase,
        price: 110,
        scrape_date: "2026-04-24"
      }
    ]);

    const rows = await loadDataset();
    const matching = rows.filter(
      (row) =>
        row.pickup_date === "2026-06-01" &&
        row.dropoff_date === "2026-06-02" &&
        row.vehicle === "trek budget"
    );

    assert.equal(firstInsert, 1);
    assert.equal(secondInsert, 1);
    assert.equal(matching.length, 2);
    assert.equal(await getPricingDataRowCount(), 2);
  } finally {
    paths.apiDbDir = originalApiDbDir;
    paths.apiPricingDbFile = originalApiPricingDbFile;
    await rm(tempRoot, { recursive: true, force: true });
  }
});
