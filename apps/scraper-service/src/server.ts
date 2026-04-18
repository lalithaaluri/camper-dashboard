import "dotenv/config";
import cors from "cors";
import express from "express";
import { z } from "zod";
import { DEPOTS } from "./config.js";
import { runAutomatedScrape } from "./scraper.js";
import {
  ensureStorage,
  loadDataset,
  loadRunHistory,
  mergeRows,
  paths,
  summarizeDataset,
  upsertRun,
  writeDataset,
  writeRunArtifact
} from "./storage.js";
import type { DepotCode, RunSummary, ScrapeRequest } from "./types.js";

const app = express();
const port = Number(process.env.PORT || 4301);
let activeRunId: string | null = null;

const scrapeRequestSchema = z.object({
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  locations: z.array(z.enum(["auckland", "christchurch"])).min(1),
  maxTripDays: z.number().int().min(1).max(31).default(30),
  headless: z.boolean().default(true)
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
    maxTripDays: request.maxTripDays,
    headless: request.headless,
    rowsCaptured: 0,
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
        : 30
  });

  return parsed;
};

app.use(cors());
app.use(express.json());
app.use("/artifacts", express.static(paths.artifactsDir));
app.use("/data", express.static(paths.dataDir));

app.get("/api/health", async (_request, response) => {
  const dataset = summarizeDataset(await loadDataset());
  const runs = await loadRunHistory();

  response.json({
    ok: true,
    activeRunId,
    depots: Object.entries(DEPOTS).map(([code, details]) => ({
      code: code as DepotCode,
      label: details.label
    })),
    latestRun: runs[0] ?? null,
    dataset
  });
});

app.get("/api/runs", async (_request, response) => {
  response.json(await loadRunHistory());
});

app.post("/api/runs", async (request, response) => {
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
      const result = await runAutomatedScrape(payload, run.id);
      const existingRows = await loadDataset();
      const mergedRows = mergeRows(existingRows, result.rows);
      await writeDataset(mergedRows);
      const artifacts = await writeRunArtifact(run.id, result.rows, result.warnings);

      await upsertRun({
        ...runningRun,
        status: "completed",
        updatedAt: new Date().toISOString(),
        rowsCaptured: result.rows.length,
        datesVisited: result.datesVisited,
        artifacts
      });
    } catch (error) {
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

ensureStorage()
  .then(() => {
    app.listen(port, () => {
      console.log(`scraper-service listening on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialise storage", error);
    process.exitCode = 1;
  });
