const express = require("express");
const cors = require("cors");
const { getDb } = require("./db");

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
});

const app = express();
const port = Number(process.env.PORT || 4302);
const host = process.env.HOST || "0.0.0.0";
const internalIngestToken = (process.env.INTERNAL_INGEST_TOKEN || "").trim();
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const NORMALIZED_SCRAPE_DATE_SQL = `
  CASE
    WHEN scrape_date GLOB '????-??-??' THEN scrape_date
    WHEN scrape_date LIKE '%/%/%' THEN
      printf(
        '%04d-%02d-%02d',
        CAST(substr(substr(scrape_date, instr(scrape_date, '/') + 1), instr(substr(scrape_date, instr(scrape_date, '/') + 1), '/') + 1) AS INTEGER),
        CAST(substr(scrape_date, 1, instr(scrape_date, '/') - 1) AS INTEGER),
        CAST(substr(substr(scrape_date, instr(scrape_date, '/') + 1), 1, instr(substr(scrape_date, instr(scrape_date, '/') + 1), '/') - 1) AS INTEGER)
      )
    ELSE NULL
  END
`;

const DURATION_DAYS_SQL = `(julianday(dropoff_date) - julianday(pickup_date))`;
const DAILY_RATE_SQL = `
  CASE
    WHEN ${DURATION_DAYS_SQL} > 0 THEN ROUND(price / ${DURATION_DAYS_SQL})
    ELSE NULL
  END
`;
const DAILY_RATE_SQL_L = `
  CASE
    WHEN (julianday(l.dropoff_date) - julianday(l.pickup_date)) > 0
      THEN ROUND(l.price / (julianday(l.dropoff_date) - julianday(l.pickup_date)))
    ELSE NULL
  END
`;

const parsePositiveInt = (value, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    return null;
  }
  return Math.min(parsed, max);
};

function normalizeVehicle(vehicle) {
  if (!vehicle) return vehicle;

  const v = String(vehicle).toLowerCase().trim();

  if (v === "trek budget") return "trekbudget";
  if (v === "trek medium") return "trekmedium";
  if (v === "trek large") return "treklarge";

  return v;
}

function normalizeVehicleRows(rows) {
  return rows.map((row) => ({
    ...row,
    vehicle: normalizeVehicle(row.vehicle)
  }));
}

function buildRouteFilters(query) {
  const conditions = [];
  const params = [];

  const pickupLocation = typeof query.pickup_location === "string"
    ? query.pickup_location.trim().toLowerCase()
    : "";
  const dropoffLocation = typeof query.dropoff_location === "string"
    ? query.dropoff_location.trim().toLowerCase()
    : "";

  const hasRouteFilter = Boolean(pickupLocation || dropoffLocation);

  if (hasRouteFilter) {
    if (pickupLocation) {
      conditions.push("COALESCE(pickup_location, location) = ?");
      params.push(pickupLocation);
    }
    if (dropoffLocation) {
      conditions.push("COALESCE(dropoff_location, location) = ?");
      params.push(dropoffLocation);
    }
  } else {
    conditions.push(
      "(pickup_location IS NULL OR dropoff_location IS NULL OR pickup_location = dropoff_location)"
    );
  }

  return { conditions, params };
}

const isAllowedOrigin = (origin) =>
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
app.options(/.*/, cors());
app.use(express.json());

const insertPricingRows = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }

  const db = getDb();
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
      website_daily_rate,
      scrape_date,
      type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  db.exec("BEGIN");
  try {
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const location = String(row.location || "").trim().toLowerCase();
      const pickupLocation = String(row.pickup_location || location).trim().toLowerCase();
      const dropoffLocation = String(row.dropoff_location || location).trim().toLowerCase();
      const price = Number(row.price);
      if (!location || !Number.isFinite(price)) continue;

      insert.run(
        String(row.pickup_date || ""),
        String(row.dropoff_date || ""),
        location,
        pickupLocation,
        dropoffLocation,
        String(row.company || "").trim().toLowerCase(),
        String(row.vehicle || "").trim().toLowerCase(),
        price,
        row.website_daily_rate === null || row.website_daily_rate === undefined
          ? null
          : Number(row.website_daily_rate),
        String(row.scrape_date || ""),
        String(row.type || "competitor").trim().toLowerCase() === "elements" ? "elements" : "competitor"
      );
      inserted += 1;
    }
    db.exec("COMMIT");
    return inserted;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

const requireInternalIngestToken = (req, res, next) => {
  if (!internalIngestToken) {
    return res.status(503).json({ error: "INTERNAL_INGEST_TOKEN is not configured" });
  }
  const headerValue = (req.get("x-internal-token") || "").trim();
  if (!headerValue || headerValue !== internalIngestToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
};

app.get("/api/health", (req, res) => {
  try {
    console.log("API HIT: /api/health");
    res.json({ ok: true });
  } catch (err) {
    console.error("HEALTH ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/internal/ingest-rows", requireInternalIngestToken, (req, res) => {
  try {
    const runId = String(req.body?.runId || "");
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const inserted = insertPricingRows(rows);
    res.json({
      ok: true,
      runId,
      received: rows.length,
      inserted
    });
  } catch (err) {
    console.error("INGEST ERROR:", err);
    res.status(500).json({ error: "Failed to ingest rows" });
  }
});

app.get("/api/latest-scrape-date", (req, res) => {
  try {
    console.log("API HIT: /api/latest-scrape-date");
    const db = getDb();
    const result = db
      .prepare(
        `
          SELECT
            MAX(${NORMALIZED_SCRAPE_DATE_SQL}) AS latest_scrape_date
          FROM pricing_data;
        `
      )
      .get();

    res.json({
      latest_scrape_date: result?.latest_scrape_date ?? null
    });
  } catch (err) {
    console.error("LATEST SCRAPE DATE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/stats", (req, res) => {
  try {
    const db = getDb();
    const stats = db
      .prepare(
        `
          SELECT
            COUNT(*) AS row_count,
            MAX(pickup_date) AS latest_pickup_date,
            MAX(${NORMALIZED_SCRAPE_DATE_SQL}) AS latest_scrape_date
          FROM pricing_data
        `
      )
      .get();

    res.json({
      row_count: Number(stats?.row_count ?? 0),
      latest_pickup_date: stats?.latest_pickup_date ?? null,
      latest_scrape_date: stats?.latest_scrape_date ?? null
    });
  } catch (err) {
    console.error("STATS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/prices", (req, res) => {
  try {
    console.log("API HIT: /api/prices");
    const db = getDb();
    const { conditions, params } = buildRouteFilters(req.query);
    const maxScrapeDates = parsePositiveInt(req.query.max_scrape_dates, { max: 365 });
    const maxPickupDates = parsePositiveInt(req.query.max_pickup_dates, { max: 730 });
    const scopedWhere = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limitParams = [];

    if (maxScrapeDates) {
      limitParams.push(maxScrapeDates);
    }
    if (maxPickupDates) {
      limitParams.push(maxPickupDates);
    }

    const rows = db
      .prepare(
        `
          WITH scoped AS (
            SELECT
              p.*,
              ${NORMALIZED_SCRAPE_DATE_SQL} AS scrape_date_key
            FROM pricing_data p
            ${scopedWhere}
          ),
          limited AS (
            SELECT *
            FROM scoped s
            WHERE 1=1
            ${maxScrapeDates ? `
              AND s.scrape_date_key IN (
                SELECT scrape_date_key
                FROM scoped
                WHERE scrape_date_key IS NOT NULL
                GROUP BY scrape_date_key
                ORDER BY scrape_date_key DESC
                LIMIT ?
              )` : ""}
            ${maxPickupDates ? `
              AND s.pickup_date IN (
                SELECT pickup_date
                FROM scoped
                GROUP BY pickup_date
                ORDER BY pickup_date DESC
                LIMIT ?
              )` : ""}
          )
          SELECT
            s.id,
            s.pickup_date,
            s.dropoff_date,
            s.location,
            COALESCE(s.pickup_location, s.location) AS pickup_location,
            COALESCE(s.dropoff_location, s.location) AS dropoff_location,
            s.company,
            s.vehicle,
            s.price,
            s.website_daily_rate,
            ${DAILY_RATE_SQL} AS daily_rate,
            s.scrape_date,
            s.type
          FROM limited s
        `
      )
      .all(...params, ...limitParams);
    res.json(normalizeVehicleRows(rows));
  } catch (err) {
    console.error("API ERROR:", err);
    res.status(500).json({ error: "Failed to fetch prices" });
  }
});

app.get("/api/prices/latest", (req, res) => {
  try {
    console.log("API HIT: /api/prices/latest");
    const db = getDb();
    const { conditions, params } = buildRouteFilters(req.query);
    const maxPickupDates = parsePositiveInt(req.query.max_pickup_dates, { max: 730 });
    const maxScrapeDates = parsePositiveInt(req.query.max_scrape_dates, { max: 365 });
    const pickupLimitParams = maxPickupDates ? [maxPickupDates] : [];
    const scrapeLimitParams = maxScrapeDates ? [maxScrapeDates] : [];
    const rows = db
      .prepare(
        `
          WITH normalized AS (
            SELECT
              p.*,
              COALESCE(p.pickup_location, p.location) AS pickup_location_key,
              COALESCE(p.dropoff_location, p.location) AS dropoff_location_key,
              ${NORMALIZED_SCRAPE_DATE_SQL} AS scrape_date_key
            FROM pricing_data p
          ),
          latest_elements AS (
            SELECT
              n.*,
              ROW_NUMBER() OVER (
                PARTITION BY
                  n.pickup_date,
                  n.dropoff_date,
                  n.pickup_location_key,
                  n.dropoff_location_key,
                  n.company,
                  n.vehicle
                ORDER BY n.scrape_date_key DESC, n.id DESC
              ) AS rn
            FROM normalized n
            WHERE n.type = 'elements'
          ),
          latest_competitors AS (
            SELECT
              n.*,
              ROW_NUMBER() OVER (
                PARTITION BY
                  n.pickup_date,
                  n.dropoff_date,
                  n.pickup_location_key,
                  n.dropoff_location_key,
                  n.company,
                  n.vehicle
                ORDER BY n.scrape_date_key DESC, n.id DESC
              ) AS rn
            FROM normalized n
            WHERE n.type = 'competitor'
          ),
          latest_rows AS (
            SELECT * FROM latest_elements WHERE rn = 1
            UNION ALL
            SELECT * FROM latest_competitors WHERE rn = 1
          ),
          latest_rows_with_route AS (
            SELECT
              lr.*,
              lr.pickup_location_key AS pickup_location,
              lr.dropoff_location_key AS dropoff_location
            FROM latest_rows lr
          ),
          latest_rows_limited AS (
            SELECT *
            FROM latest_rows_with_route l
            WHERE 1=1
            ${maxScrapeDates ? `
              AND ${NORMALIZED_SCRAPE_DATE_SQL} IN (
                SELECT ${NORMALIZED_SCRAPE_DATE_SQL} AS scrape_date_key
                FROM latest_rows_with_route
                WHERE ${NORMALIZED_SCRAPE_DATE_SQL} IS NOT NULL
                GROUP BY scrape_date_key
                ORDER BY scrape_date_key DESC
                LIMIT ?
              )` : ""}
            ${maxPickupDates ? `
              AND l.pickup_date IN (
                SELECT pickup_date
                FROM latest_rows_with_route
                GROUP BY pickup_date
                ORDER BY pickup_date DESC
                LIMIT ?
              )` : ""}
          )
          SELECT
            l.id,
            l.pickup_date,
            l.dropoff_date,
            l.location,
            l.pickup_location,
            l.dropoff_location,
            l.company,
            l.vehicle,
            l.price,
            l.website_daily_rate,
            ${DAILY_RATE_SQL_L} AS daily_rate,
            l.scrape_date,
            l.type
          FROM latest_rows_limited l
          ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        `
      )
      .all(...scrapeLimitParams, ...pickupLimitParams, ...params);
    res.json(normalizeVehicleRows(rows));
  } catch (err) {
    console.error("LATEST PRICES ERROR:", err);
    res.status(500).json({ error: "Failed to fetch latest prices" });
  }
});

app.get("/api/trends", async (req, res) => {
  try {
    console.log("API HIT: /api/trends");
    const db = getDb();
    const { conditions, params } = buildRouteFilters(req.query);
    const allowedFilters = ["vehicle", "location"];
    const maxScrapeDates = parsePositiveInt(req.query.max_scrape_dates, { max: 365 });
    const maxPickupDates = parsePositiveInt(req.query.max_pickup_dates, { max: 730 });

    for (const key of allowedFilters) {
      const value = req.query[key];
      if (typeof value === "string" && value.trim() !== "") {
        conditions.push(`${key} = ?`);
        params.push(value.trim());
      }
    }

    const query = `
        WITH scoped AS (
          SELECT
            p.*,
            ${NORMALIZED_SCRAPE_DATE_SQL} AS scrape_date_key
          FROM pricing_data p
          ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        ),
        limited AS (
          SELECT *
          FROM scoped s
          WHERE 1=1
          ${maxScrapeDates ? `
            AND s.scrape_date_key IN (
              SELECT scrape_date_key
              FROM scoped
              WHERE scrape_date_key IS NOT NULL
              GROUP BY scrape_date_key
              ORDER BY scrape_date_key DESC
              LIMIT ?
            )` : ""}
          ${maxPickupDates ? `
            AND s.pickup_date IN (
              SELECT pickup_date
              FROM scoped
              GROUP BY pickup_date
              ORDER BY pickup_date DESC
              LIMIT ?
            )` : ""}
        )
        SELECT
          pickup_date,
          dropoff_date,
          location,
          COALESCE(pickup_location, location) AS pickup_location,
          COALESCE(dropoff_location, location) AS dropoff_location,
          company,
          vehicle,
          price,
          website_daily_rate,
          ${DAILY_RATE_SQL} AS daily_rate,
          scrape_date,
          type
        FROM limited
        ;
      `;
    const limitParams = [];
    if (maxScrapeDates) {
      limitParams.push(maxScrapeDates);
    }
    if (maxPickupDates) {
      limitParams.push(maxPickupDates);
    }
    const rows = db.prepare(query).all(...params, ...limitParams);
    res.json(normalizeVehicleRows(rows));
  } catch (err) {
    console.error("TRENDS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, host, () => {
  getDb();
  console.log("SERVER STARTED SUCCESSFULLY");
  console.log(`API listening on http://${host}:${port}`);
});
