import { afterAll, beforeAll, describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";

type PriceRow = {
  pickup_date: string;
  dropoff_date: string;
  location: string;
  company: string;
  vehicle: string;
  price: number;
  scrape_date: string;
  type: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const apiRoot = path.join(repoRoot, "apps", "api");

const normalize = (value: string) => String(value || "").toLowerCase().replace(/\s+/g, "");

const competitorMap: Record<string, string[]> = {
  treklarge: ["campervanvillageaventus2"],
  trekmedium: ["happycamperssleeper"]
};

let runtimeDir = "";
let apiProcess: ChildProcessWithoutNullStreams | null = null;
let apiBaseUrl = "";

const seededRows: PriceRow[] = [
  {
    pickup_date: "2026-08-10",
    dropoff_date: "2026-08-14",
    location: "auckland",
    company: "elementsworld",
    vehicle: "trek large",
    price: 780,
    scrape_date: "2026-05-01",
    type: "elements"
  },
  {
    pickup_date: "2026-08-10",
    dropoff_date: "2026-08-14",
    location: "auckland",
    company: "campervanvillage",
    vehicle: "aventus2",
    price: 730,
    scrape_date: "2026-05-01",
    type: "competitor"
  },
  {
    pickup_date: "2026-08-10",
    dropoff_date: "2026-08-14",
    location: "auckland",
    company: "campervanvillage",
    vehicle: "aventus2",
    price: 700,
    scrape_date: "2026-05-02",
    type: "competitor"
  },
  {
    pickup_date: "2026-08-12",
    dropoff_date: "2026-08-16",
    location: "christchurch",
    company: "elementsworld",
    vehicle: "trek medium",
    price: 640,
    scrape_date: "2026-05-02",
    type: "elements"
  },
  {
    pickup_date: "2026-08-12",
    dropoff_date: "2026-08-16",
    location: "christchurch",
    company: "campervanvillage",
    vehicle: "aventus2",
    price: 600,
    scrape_date: "2026-05-02",
    type: "competitor"
  }
];

const createRuntime = () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const nextRuntimeDir = path.join(apiRoot, "tests", ".runtime", `recommendation-${suffix}`);
  const runtimeSrc = path.join(nextRuntimeDir, "src");
  const runtimeData = path.join(nextRuntimeDir, "data");

  fs.mkdirSync(runtimeSrc, { recursive: true });
  fs.mkdirSync(runtimeData, { recursive: true });

  for (const fileName of ["server.js", "db.js"]) {
    fs.copyFileSync(path.join(apiRoot, "src", fileName), path.join(runtimeSrc, fileName));
  }

  return {
    runtimeDir: nextRuntimeDir,
    dbPath: path.join(runtimeData, "pricing.db")
  };
};

const seedDatabase = (dbPath: string, rows: PriceRow[]) => {
  const db = new Database(dbPath);
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

  const insert = db.prepare(`
    INSERT INTO pricing_data (
      pickup_date,
      dropoff_date,
      location,
      company,
      vehicle,
      price,
      scrape_date,
      type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((inputRows: PriceRow[]) => {
    for (const row of inputRows) {
      insert.run(
        row.pickup_date,
        row.dropoff_date,
        row.location,
        row.company,
        row.vehicle,
        row.price,
        row.scrape_date,
        row.type
      );
    }
  });

  insertMany(rows);
  db.close();
};

const waitForHealth = async (baseUrl: string, timeoutMs = 10000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error(`API did not become healthy within ${timeoutMs}ms`);
};

const stopProcess = async (processHandle: ChildProcessWithoutNullStreams | null) => {
  if (!processHandle || processHandle.killed) {
    return;
  }

  processHandle.kill("SIGTERM");

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (!processHandle.killed) {
        processHandle.kill("SIGKILL");
      }
      resolve();
    }, 2000);

    processHandle.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
};

type RecommendationResult = {
  baseline: number | null;
  source: "competitor" | "elements" | null;
  recommended: number | null;
};

const computeRecommendation = ({
  rows,
  pickup,
  dropoff,
  location,
  vehicle,
  adjustmentPercent
}: {
  rows: PriceRow[];
  pickup: string;
  dropoff: string;
  location: string;
  vehicle: string;
  adjustmentPercent: number;
}): RecommendationResult => {
  const selectedVehicleKey = normalize(vehicle);
  const mappedCompetitors = competitorMap[selectedVehicleKey] || [];

  const filteredRows = rows.filter(
    (row) =>
      row.pickup_date === pickup &&
      row.dropoff_date === dropoff &&
      normalize(row.location) === normalize(location)
  );

  const elementsRows = filteredRows.filter(
    (row) => normalize(row.company) === "elementsworld" && normalize(row.vehicle) === selectedVehicleKey
  );

  const competitorRows = filteredRows.filter((row) => {
    if (normalize(row.company) === "elementsworld") {
      return false;
    }

    const token = normalize(`${row.company}${row.vehicle}`);
    return mappedCompetitors.some((mapped) => token.includes(mapped));
  });

  const cheapestCompetitor = competitorRows.length
    ? Math.min(...competitorRows.map((row) => Number(row.price)))
    : null;
  const elementsPrice = elementsRows.length ? Number(elementsRows[0].price) : null;

  const baseline =
    cheapestCompetitor !== null
      ? cheapestCompetitor
      : elementsPrice !== null
      ? elementsPrice
      : null;

  return {
    baseline,
    source:
      baseline === null
        ? null
        : cheapestCompetitor !== null
        ? "competitor"
        : "elements",
    recommended:
      baseline === null ? null : Math.round(baseline * (1 + adjustmentPercent / 100))
  };
};

beforeAll(async () => {
  const runtime = createRuntime();
  runtimeDir = runtime.runtimeDir;
  seedDatabase(runtime.dbPath, seededRows);

  const port = 4800 + Math.floor(Math.random() * 200);
  apiBaseUrl = `http://127.0.0.1:${port}`;

  apiProcess = spawn(process.execPath, ["src/server.js"], {
    cwd: runtimeDir,
    env: {
      ...process.env,
      PORT: String(port)
    },
    stdio: "pipe"
  });

  await waitForHealth(apiBaseUrl);
});

afterAll(async () => {
  await stopProcess(apiProcess);

  if (runtimeDir && fs.existsSync(runtimeDir)) {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }
});

describe("same-location recommendation baseline", () => {
  test("uses cheapest competitor when available, otherwise falls back to Elements and never returns N/A when Elements exists", async () => {
    const response = await fetch(`${apiBaseUrl}/api/prices/latest`);
    expect(response.ok).toBe(true);

    const latestRows = (await response.json()) as PriceRow[];

    const withCompetitor = computeRecommendation({
      rows: latestRows,
      pickup: "2026-08-10",
      dropoff: "2026-08-14",
      location: "auckland",
      vehicle: "trek large",
      adjustmentPercent: 5
    });

    expect(withCompetitor).toMatchObject({
      baseline: 700,
      source: "competitor",
      recommended: 735
    });

    const fallbackToElements = computeRecommendation({
      rows: latestRows,
      pickup: "2026-08-12",
      dropoff: "2026-08-16",
      location: "christchurch",
      vehicle: "trek medium",
      adjustmentPercent: 5
    });

    expect(fallbackToElements).toMatchObject({
      baseline: 640,
      source: "elements",
      recommended: 672
    });
    expect(fallbackToElements.recommended).not.toBeNull();
  });
});
