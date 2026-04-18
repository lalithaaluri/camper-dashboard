import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadDataset, mergeRows, paths, writeDataset } from "./storage.js";
import type { PriceRow } from "./types.js";

const csvHeader = "pickup_date,dropoff_date,location,company,vehicle,price,scrape_date,type\n";

const toCsv = (rows: string[]) => `${csvHeader}${rows.join("\n")}\n`;

test("loadDataset prefers the dashboard public CSV as the master dataset", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "camper-storage-test-"));
  const originalDashboardDatasetFile = paths.dashboardDatasetFile;
  const originalDatasetFile = paths.datasetFile;

  try {
    paths.dashboardDatasetFile = path.join(tempRoot, "dashboard.csv");
    paths.datasetFile = path.join(tempRoot, "service.csv");

    await writeFile(
      paths.dashboardDatasetFile,
      toCsv(["2026-04-01,2026-04-02,auckland,elementsworld,tandem,111,2026-04-18,elements"]),
      "utf8"
    );
    await writeFile(
      paths.datasetFile,
      toCsv(["2026-04-03,2026-04-04,christchurch,mighty,deuce,222,2026-04-18,competitor"]),
      "utf8"
    );

    const rows = await loadDataset();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.pickup_date, "2026-04-01");
    assert.equal(rows[0]?.price, 111);
  } finally {
    paths.dashboardDatasetFile = originalDashboardDatasetFile;
    paths.datasetFile = originalDatasetFile;
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
