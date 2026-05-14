import "dotenv/config";
import cors from "cors";
import express from "express";
import { z } from "zod";
import { DEPOTS } from "./config.js";
import { runAutomatedScrape } from "./scraper.js";
import {
  deleteBadTrekScrapeBatch,
  ensureStorage,
  getPricingDataRowCount,
  insertPricingRows,
  loadDataset,
  loadRunHistory,
  paths,
  summarizeDataset,
  upsertRun,
  writeDataset,
  writeRunArtifact
} from "./storage.js";
import type { DepotCode, PriceRow, RoutePair, RunSummary, ScrapeRequest } from "./types.js";

const app = express();
const port = Number(process.env.PORT || 4301);
const host = process.env.HOST || "0.0.0.0";
const pricingApiBaseUrl = (process.env.PRICING_API_BASE_URL || "").trim().replace(/\/+$/, "");
const internalIngestToken = (process.env.INTERNAL_INGEST_TOKEN || "").trim();
const dashboardTriggerToken = (process.env.DASHBOARD_TRIGGER_TOKEN || "").trim();
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
let activeRunId: string | null = null;
const AUTO_RUN = false;
const depotSchema = z.enum(["auckland", "christchurch"]);
const routePairSchema = z.object({
  pickupLocation: depotSchema,
  dropoffLocation: depotSchema
});

const shouldWriteCsvBackup = () => {
  const value = (process.env.SCRAPER_WRITE_CSV_BACKUP ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
};

const scrapeRequestSchema = z.object({
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  locations: z.array(depotSchema).default([]),
  routePairs: z.array(routePairSchema).default([]),
  maxTripDays: z.number().int().min(1).max(31).default(3),
  headless: z.boolean().default(true)
}).superRefine((value, ctx) => {
  if (value.locations.length === 0 && value.routePairs.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide at least one location or one route pair."
    });
  }
});

const createRunSummary = (request: ScrapeRequest): RunSummary => {
  const timestamp = new Date().toISOString();

  return {
    id: `${Date.now()}`,
    status: "queued",
    createdAt: timestamp,
    updatedAt: timestamp,
    pickupDate: request.pickupDate,
    locations: request.locations,
    routePairs: request.routePairs,
    maxTripDays: request.maxTripDays,
    headless: request.headless,
    rowsCaptured: 0,
    rowsProcessed: 0,
    rowsInserted: 0,
    totalRows: 0,
    datesVisited: 0
  };
};

const normalizeRequest = (body: unknown): ScrapeRequest => {
  const source = body && typeof body === "object" ? body : {};
  const parsed = scrapeRequestSchema.parse({
    ...source,
    maxTripDays:
      typeof source === "object" &&
      source !== null &&
      "maxTripDays" in source
        ? Number(source.maxTripDays)
        : 3
  });

  const dedupedLocations = Array.from(new Set(parsed.locations));
  const dedupedRoutePairs = Array.from(
    new Map(
      parsed.routePairs.map((pair) => [
        `${pair.pickupLocation}|${pair.dropoffLocation}`,
        pair
      ])
    ).values()
  ) as RoutePair[];

  return {
    ...parsed,
    locations: dedupedLocations,
    routePairs: dedupedRoutePairs
  };
};

const clearStaleActiveRunLock = async () => {
  if (!activeRunId) {
    return;
  }

  const runs = await loadRunHistory();
  const activeRun = runs.find((run) => run.id === activeRunId) ?? null;
  const isActuallyActive =
    activeRun?.status === "running" || activeRun?.status === "queued";

  if (!isActuallyActive) {
    activeRunId = null;
  }
};

const recoverStaleRunLock = async () => {
  await clearStaleActiveRunLock();
  const runs = await loadRunHistory();
  const latestRun = runs[0] ?? null;
  if (!latestRun) {
    return null;
  }

  const hasMatchingActiveRun =
    Boolean(activeRunId) && latestRun.id === activeRunId;
  if (hasMatchingActiveRun) {
    return latestRun;
  }

  if (latestRun.status !== "running" && latestRun.status !== "queued") {
    return latestRun;
  }

  const recoveredRun: RunSummary = {
    ...latestRun,
    status: "failed",
    updatedAt: new Date().toISOString(),
    error:
      latestRun.error ||
      "Run interrupted: scraper service restarted before the job completed."
  };

  await upsertRun(recoveredRun);
  return recoveredRun;
};

const ingestRowsToApi = async (runId: string, rows: PriceRow[]) => {
  if (!pricingApiBaseUrl) {
    return null;
  }
  if (!internalIngestToken) {
    throw new Error("INTERNAL_INGEST_TOKEN is required when PRICING_API_BASE_URL is set");
  }

  const url = `${pricingApiBaseUrl}/api/internal/ingest-rows`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-token": internalIngestToken
    },
    body: JSON.stringify({ runId, rows })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed ingest to API (${response.status}): ${body}`);
  }
  const payload = (await response.json()) as { inserted?: number };
  return Number(payload.inserted ?? 0);
};

const isAllowedOrigin = (origin: string) =>
  allowedOrigins.length === 0 || allowedOrigins.includes(origin);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("CORS origin not allowed"));
    }
  })
);
app.use(express.json());
app.use("/artifacts", express.static(paths.artifactsDir));
app.use("/data", express.static(paths.dataDir));

const requireDashboardTriggerToken: express.RequestHandler = (request, response, next) => {
  if (!dashboardTriggerToken) {
    response.status(503).json({ error: "DASHBOARD_TRIGGER_TOKEN is not configured" });
    return;
  }

  const token = (request.get("x-dashboard-token") || "").trim();
  if (!token || token !== dashboardTriggerToken) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
};

app.get("/api/health", async (_request, response) => {
  await clearStaleActiveRunLock();
  const recoveredRun = await recoverStaleRunLock();
  const dataset = summarizeDataset(await loadDataset());
  const runs = await loadRunHistory();
  const latestRun = recoveredRun ?? runs[0] ?? null;

  response.json({
    ok: true,
    activeRunId,
    depots: Object.entries(DEPOTS).map(([code, details]) => ({
      code: code as DepotCode,
      label: details.label
    })),
    latestRun,
    latestRunError: latestRun?.error ?? null,
    dataset
  });
});

app.get("/api/runs", async (_request, response) => {
  response.json(await loadRunHistory());
});

app.post("/api/runs", requireDashboardTriggerToken, async (request, response) => {
  await clearStaleActiveRunLock();
  if (activeRunId) {
    response.status(409).json({
      error: "A scrape run is already in progress.",
      activeRunId
    });
    return;
  }

  let payload: ScrapeRequest;

  try {
    payload = normalizeRequest(request.body);
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Invalid request body"
    });
    return;
  }

  const run = createRunSummary(payload);
  activeRunId = run.id;
  await upsertRun(run);

  void (async () => {
    const runningRun: RunSummary = {
      ...run,
      status: "running",
      updatedAt: new Date().toISOString()
    };
    await upsertRun(runningRun);

    try {
      const result = await runAutomatedScrape(payload, run.id, async (progress) => {
        const totalRowsSoFar = await getPricingDataRowCount();
        await upsertRun({
          ...runningRun,
          status: "running",
          updatedAt: new Date().toISOString(),
          rowsCaptured: progress.rowsProcessed,
          rowsProcessed: progress.rowsProcessed,
          rowsInserted: 0,
          totalRows: totalRowsSoFar,
          datesVisited: progress.datesVisited
        });
      });
      const rowsProcessed = result.rowsProcessed;
      const apiInserted = await ingestRowsToApi(run.id, result.rows);
      const rowsInserted = apiInserted ?? (await insertPricingRows(result.rows));
      const totalRows = await getPricingDataRowCount();
      if (shouldWriteCsvBackup()) {
        await writeDataset(await loadDataset());
      }
      const artifacts = await writeRunArtifact(run.id, result.rows, result.warnings);

      await upsertRun({
        ...runningRun,
        status: "completed",
        updatedAt: new Date().toISOString(),
        rowsCaptured: rowsProcessed,
        rowsProcessed,
        rowsInserted,
        totalRows,
        datesVisited: result.datesVisited,
        artifacts
      });
    } catch (error) {
      console.error("SCRAPER ERROR:", error);
      await upsertRun({
        ...runningRun,
        status: "failed",
        updatedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown scraping error"
      });
    } finally {
      activeRunId = null;
    }
  })();

  response.status(202).json(run);
});

app.post("/api/fix-trek-june-auckland", requireDashboardTriggerToken, async (req, res) => {
  try {
    // Step 1: remove incorrect Trek data from that scrape batch
    const deleted = await deleteBadTrekScrapeBatch();

    // Step 2: run scraper again for June Auckland
    const result = await runAutomatedScrape(
      {
        pickupDate: "2026-06-01",
        locations: ["auckland"],
        routePairs: [],
        maxTripDays: 3,
        headless: true
      },
      `fix-trek-june-auckland-${Date.now()}`
    );

    // Step 3: insert corrected rows
    const apiInserted = await ingestRowsToApi(`fix-trek-june-auckland-${Date.now()}`, result.rows);
    const inserted = apiInserted ?? (await insertPricingRows(result.rows));

    res.json({
      success: true,
      deletedRows: deleted,
      insertedRows: inserted
    });
  } catch (err) {
    console.error("Fix failed", err);
    res.status(500).json({ error: "Fix failed" });
  }
});

ensureStorage()
  .then(async () => {
    await recoverStaleRunLock();
    app.listen(port, host, () => {
      console.log(`scraper-service listening on http://${host}:${port}`);
      void AUTO_RUN;
    });
  })
  .catch((error) => {
    console.error("Failed to initialise storage", error);
    process.exitCode = 1;
  });
