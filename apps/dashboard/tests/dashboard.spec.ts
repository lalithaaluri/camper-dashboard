const { test, expect } = require("@playwright/test");
const { copyFileSync, existsSync, mkdirSync, rmSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { spawn } = require("node:child_process");
const { createRequire } = require("node:module");

type SeedRow = {
  pickup_date: string;
  dropoff_date: string;
  location: string;
  company: string;
  vehicle: string;
  price: number;
  scrape_date: string;
  type: string;
};

const repoRoot = resolve(__dirname, "..", "..", "..");
const apiRoot = join(repoRoot, "apps", "api");

const apiRequire = createRequire(join(apiRoot, "package.json"));
const Database = apiRequire("better-sqlite3");

let runtimeDir = "";
let apiProcess: any = null;
let dashboardProcess: any = null;
let apiBaseUrl = "";
let dashboardBaseUrl = "";

const seededRows: SeedRow[] = [
  {
    pickup_date: "2026-09-01",
    dropoff_date: "2026-09-05",
    location: "auckland",
    company: "elementsworld",
    vehicle: "trek budget",
    price: 560,
    scrape_date: "2026-05-05",
    type: "elements"
  },
  {
    pickup_date: "2026-09-01",
    dropoff_date: "2026-09-05",
    location: "auckland",
    company: "travellersautobarn",
    vehicle: "station wagon",
    price: 510,
    scrape_date: "2026-05-05",
    type: "competitor"
  },
  {
    pickup_date: "2026-09-01",
    dropoff_date: "2026-09-05",
    location: "christchurch",
    company: "elementsworld",
    vehicle: "trek budget",
    price: 540,
    scrape_date: "2026-05-05",
    type: "elements"
  },
  {
    pickup_date: "2026-09-01",
    dropoff_date: "2026-09-05",
    location: "christchurch",
    company: "travellersautobarn",
    vehicle: "station wagon",
    price: 495,
    scrape_date: "2026-05-05",
    type: "competitor"
  }
];

const createRuntime = () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const nextRuntimeDir = join(apiRoot, "tests", ".runtime", `dashboard-${suffix}`);
  const runtimeSrc = join(nextRuntimeDir, "src");
  const runtimeData = join(nextRuntimeDir, "data");

  mkdirSync(runtimeSrc, { recursive: true });
  mkdirSync(runtimeData, { recursive: true });

  for (const fileName of ["server.js", "db.js"]) {
    copyFileSync(join(apiRoot, "src", fileName), join(runtimeSrc, fileName));
  }

  return {
    runtimeDir: nextRuntimeDir,
    dbPath: join(runtimeData, "pricing.db")
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

  const insertMany = db.transaction((inputRows: SeedRow[]) => {
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

const waitForHttp = async (url: string, timeoutMs = 45000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }

    await new Promise((resolveTimer) => setTimeout(resolveTimer, 250));
  }

  throw new Error(`Timed out waiting for ${url}`);
};

const stopProcess = async (processHandle: any) => {
  if (!processHandle || processHandle.killed) {
    return;
  }

  processHandle.kill("SIGTERM");

  await new Promise<void>((resolveDone) => {
    const timeout = setTimeout(() => {
      if (!processHandle.killed) {
        processHandle.kill("SIGKILL");
      }
      resolveDone();
    }, 4000);

    processHandle.once("exit", () => {
      clearTimeout(timeout);
      resolveDone();
    });
  });
};

test.beforeAll(async () => {
  const runtime = createRuntime();
  runtimeDir = runtime.runtimeDir;
  seedDatabase(runtime.dbPath, seededRows);

  const apiPort = 4900 + Math.floor(Math.random() * 100);
  const dashboardPort = 3000;

  apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  dashboardBaseUrl = `http://127.0.0.1:${dashboardPort}`;

  apiProcess = spawn(process.execPath, ["src/server.js"], {
    cwd: runtimeDir,
    env: {
      ...process.env,
      PORT: String(apiPort)
    },
    stdio: "pipe"
  });

  await waitForHttp(`${apiBaseUrl}/api/health`, 12000);

  if (process.platform === "win32") {
    const comspec = process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
    dashboardProcess = spawn(comspec, ["/d", "/s", "/c", "pnpm --filter dashboard start"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CI: "true",
        BROWSER: "none",
        PORT: String(dashboardPort),
        REACT_APP_PRICING_API_URL: apiBaseUrl,
        REACT_APP_SCRAPER_API_URL: "http://127.0.0.1:1"
      },
      stdio: "pipe"
    });
  } else {
    dashboardProcess = spawn("pnpm", ["--filter", "dashboard", "start"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CI: "true",
        BROWSER: "none",
        PORT: String(dashboardPort),
        REACT_APP_PRICING_API_URL: apiBaseUrl,
        REACT_APP_SCRAPER_API_URL: "http://127.0.0.1:1"
      },
      stdio: "pipe"
    });
  }

  await waitForHttp(dashboardBaseUrl, 90000);
});

test.afterAll(async () => {
  await stopProcess(dashboardProcess);
  await stopProcess(apiProcess);

  if (runtimeDir && existsSync(runtimeDir)) {
    rmSync(runtimeDir, { recursive: true, force: true });
  }
});

test("dashboard loads SQLite pricing data and renders KPI/table without sticking on loading", async ({ page }: any) => {
  await page.goto(dashboardBaseUrl, { waitUntil: "domcontentloaded" });

  await expect(
    page.getByRole("heading", { name: /AI-Assisted Pricing Decision Support/i })
  ).toBeVisible({ timeout: 60000 });
  await expect(page.getByText(/Loading dashboard/i)).toHaveCount(0);

  await expect(page.getByText(/Recommended price/i)).toBeVisible();
  await expect(page.locator(".hero-highlight strong").first()).not.toHaveText("N/A");

  await page.getByRole("button", { name: /Competitors/i }).click();
  await expect(page.getByRole("heading", { name: /Competitor rows/i })).toBeVisible();

  const tableRows = page.locator("table tbody tr");
  await expect(tableRows.first()).toBeVisible();
  expect(await tableRows.count()).toBeGreaterThan(0);
  await expect(page.getByText(/travellersautobarn/i)).toBeVisible();
});
