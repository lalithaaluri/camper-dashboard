import { afterAll, beforeAll, describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";

type SeedRow = {
  pickup_date: string;
  dropoff_date: string;
  location: string;
  pickup_location?: string;
  dropoff_location?: string;
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

let runtimeDir = "";
let apiProcess: ChildProcessWithoutNullStreams | null = null;
let apiBaseUrl = "";

const seededRows: SeedRow[] = [
  {
    pickup_date: "2026-06-01",
    dropoff_date: "2026-06-05",
    location: "auckland",
    company: "campervanvillage",
    vehicle: "aventus2",
    price: 450,
    scrape_date: "2026-04-20",
    type: "competitor"
  },
  {
    pickup_date: "2026-06-01",
    dropoff_date: "2026-06-05",
    location: "auckland",
    company: "campervanvillage",
    vehicle: "aventus2",
    price: 430,
    scrape_date: "2026-04-21",
    type: "competitor"
  },
  {
    pickup_date: "2026-06-01",
    dropoff_date: "2026-06-05",
    location: "christchurch",
    company: "happycampers",
    vehicle: "sleeper",
    price: 470,
    scrape_date: "2026-04-20",
    type: "competitor"
  },
  {
    pickup_date: "2026-06-01",
    dropoff_date: "2026-06-05",
    location: "christchurch",
    company: "happycampers",
    vehicle: "sleeper",
    price: 465,
    scrape_date: "2026-04-22",
    type: "competitor"
  },
  {
    pickup_date: "2026-07-01",
    dropoff_date: "2026-07-05",
    location: "auckland",
    company: "elementsworld",
    vehicle: "trek budget",
    price: 510,
    scrape_date: "2026-04-22",
    type: "elements"
  },
  {
    pickup_date: "2026-07-01",
    dropoff_date: "2026-07-05",
    location: "auckland",
    company: "elementsworld",
    vehicle: "trek medium",
    price: 610,
    scrape_date: "2026-04-22",
    type: "elements"
  },
  {
    pickup_date: "2026-07-01",
    dropoff_date: "2026-07-05",
    location: "auckland",
    company: "elementsworld",
    vehicle: "trek large",
    price: 725,
    scrape_date: "2026-04-20",
    type: "elements"
  },
  {
    pickup_date: "2026-07-01",
    dropoff_date: "2026-07-05",
    location: "auckland",
    company: "elementsworld",
    vehicle: "trek large",
    price: 710,
    scrape_date: "2026-04-22",
    type: "elements"
  },
  {
    pickup_date: "2026-07-01",
    dropoff_date: "2026-07-05",
    location: "auckland",
    pickup_location: "auckland",
    dropoff_location: "christchurch",
    company: "jucy",
    vehicle: "crib",
    price: 805,
    scrape_date: "2026-04-20",
    type: "competitor"
  },
  {
    pickup_date: "2026-07-01",
    dropoff_date: "2026-07-05",
    location: "auckland",
    pickup_location: "auckland",
    dropoff_location: "christchurch",
    company: "jucy",
    vehicle: "crib",
    price: 780,
    scrape_date: "2026-04-22",
    type: "competitor"
  },
  {
    pickup_date: "2026-07-01",
    dropoff_date: "2026-07-05",
    location: "christchurch",
    pickup_location: "christchurch",
    dropoff_location: "auckland",
    company: "happycampers",
    vehicle: "sleeper",
    price: 799,
    scrape_date: "2026-04-22",
    type: "competitor"
  },
  {
    pickup_date: "2026-07-01",
    dropoff_date: "2026-07-05",
    location: "auckland",
    company: "travellersautobarn",
    vehicle: "station wagon",
    price: 490,
    scrape_date: "2026-04-22",
    type: "competitor"
  },
  {
    pickup_date: "2026-07-01",
    dropoff_date: "2026-07-05",
    location: "auckland",
    company: "happycampers",
    vehicle: "sleeper",
    price: 590,
    scrape_date: "2026-04-22",
    type: "competitor"
  },
  {
    pickup_date: "2026-07-01",
    dropoff_date: "2026-07-05",
    location: "auckland",
    company: "campervanvillage",
    vehicle: "aventus2",
    price: 690,
    scrape_date: "2026-04-22",
    type: "competitor"
  }
];

const createRuntime = () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const nextRuntimeDir = path.join(apiRoot, "tests", ".runtime", `prices-${suffix}`);
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

const seedDatabase = (dbPath: string, rows: SeedRow[]) => {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS pricing_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pickup_date TEXT,
      dropoff_date TEXT,
      location TEXT,
      pickup_location TEXT,
      dropoff_location TEXT,
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
      pickup_location,
      dropoff_location,
      company,
      vehicle,
      price,
      scrape_date,
      type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((inputRows: SeedRow[]) => {
    for (const row of inputRows) {
      insert.run(
        row.pickup_date,
        row.dropoff_date,
        row.location,
        row.pickup_location ?? null,
        row.dropoff_location ?? null,
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
      // keep polling
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

beforeAll(async () => {
  const runtime = createRuntime();
  runtimeDir = runtime.runtimeDir;
  seedDatabase(runtime.dbPath, seededRows);

  const port = 4600 + Math.floor(Math.random() * 200);
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

describe("/api/prices baseline regression", () => {
  test("/api/prices includes pickup_location and dropoff_location while keeping location", async () => {
    const response = await fetch(`${apiBaseUrl}/api/prices`);
    expect(response.ok).toBe(true);

    const rows = (await response.json()) as Array<SeedRow & { pickup_location: string; dropoff_location: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("location");
    expect(rows[0]).toHaveProperty("pickup_location");
    expect(rows[0]).toHaveProperty("dropoff_location");
  });

  test("/api/prices/latest returns only latest scrape row per trip/company/vehicle combination", async () => {
    const response = await fetch(`${apiBaseUrl}/api/prices/latest`);
    expect(response.ok).toBe(true);

    const rows = (await response.json()) as SeedRow[];
    const groupedCounts = new Map<string, number>();

    for (const row of rows) {
      const key = [row.pickup_date, row.dropoff_date, row.location, row.company, row.vehicle].join("|");
      groupedCounts.set(key, (groupedCounts.get(key) || 0) + 1);
    }

    expect(Array.from(groupedCounts.values()).every((count) => count === 1)).toBe(true);

    const aucklandLatest = rows.find(
      (row) =>
        row.pickup_date === "2026-06-01" &&
        row.dropoff_date === "2026-06-05" &&
        row.location === "auckland" &&
        row.company === "campervanvillage" &&
        row.vehicle === "aventus2"
    );
    expect(aucklandLatest).toMatchObject({
      scrape_date: "2026-04-21",
      price: 430
    });

    const christchurchLatest = rows.find(
      (row) =>
        row.pickup_date === "2026-06-01" &&
        row.dropoff_date === "2026-06-05" &&
        row.location === "christchurch" &&
        row.company === "happycampers" &&
        row.vehicle === "sleeper"
    );
    expect(christchurchLatest).toMatchObject({
      scrape_date: "2026-04-22",
      price: 465
    });
  });

  test("historical trends preserve multiple rows when scrape_date differs", async () => {
    const response = await fetch(`${apiBaseUrl}/api/prices`);
    expect(response.ok).toBe(true);

    const rows = (await response.json()) as SeedRow[];
    const history = rows.filter(
      (row) =>
        row.pickup_date === "2026-06-01" &&
        row.dropoff_date === "2026-06-05" &&
        row.location === "auckland" &&
        row.company === "campervanvillage" &&
        row.vehicle === "aventus2"
    );

    expect(history).toHaveLength(2);
    expect(history.map((row) => row.scrape_date).sort()).toEqual([
      "2026-04-20",
      "2026-04-21"
    ]);
  });

  test("trekbudget/trekmedium/treklarge stay distinct and competitor rows are preserved", async () => {
    const response = await fetch(`${apiBaseUrl}/api/prices/latest`);
    expect(response.ok).toBe(true);

    const rows = (await response.json()) as SeedRow[];

    const trekRows = rows.filter(
      (row) =>
        row.pickup_date === "2026-07-01" &&
        row.dropoff_date === "2026-07-05" &&
        row.location === "auckland" &&
        row.company === "elementsworld" &&
        ["trekbudget", "trekmedium", "treklarge"].includes(String(row.vehicle))
    );

    expect(trekRows).toHaveLength(3);
    expect(new Set(trekRows.map((row) => row.vehicle))).toEqual(
      new Set(["trekbudget", "trekmedium", "treklarge"])
    );

    const competitorPairs = rows
      .filter(
        (row) =>
          row.pickup_date === "2026-07-01" &&
          row.dropoff_date === "2026-07-05" &&
          row.location === "auckland" &&
          row.company !== "elementsworld"
      )
      .map((row) => `${row.company}:${row.vehicle}`)
      .sort();

    expect(competitorPairs).toEqual([
      "campervanvillage:aventus2",
      "happycampers:sleeper",
      "travellersautobarn:station wagon"
    ]);
  });

  test("default /api/prices behavior remains same-location only", async () => {
    const response = await fetch(`${apiBaseUrl}/api/prices`);
    expect(response.ok).toBe(true);

    const rows = (await response.json()) as Array<SeedRow & { pickup_location: string; dropoff_location: string }>;
    expect(
      rows.every((row) => row.pickup_location === row.dropoff_location)
    ).toBe(true);
  });

  test("cross-location rows are retrievable with pickup/dropoff filters", async () => {
    const response = await fetch(
      `${apiBaseUrl}/api/prices/latest?pickup_location=auckland&dropoff_location=christchurch`
    );
    expect(response.ok).toBe(true);

    const rows = (await response.json()) as Array<SeedRow & { pickup_location: string; dropoff_location: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.every(
        (row) =>
          row.pickup_location === "auckland" && row.dropoff_location === "christchurch"
      )
    ).toBe(true);

    const jucyCrib = rows.find(
      (row) => row.company === "jucy" && row.vehicle === "crib"
    );
    expect(jucyCrib).toMatchObject({
      scrape_date: "2026-04-22",
      price: 780
    });
  });
});
