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

app.use(
  cors({
    origin: "http://localhost:3000",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"]
  })
);
app.options(/.*/, cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  try {
    console.log("API HIT: /api/health");
    res.json({ ok: true });
  } catch (err) {
    console.error("HEALTH ERROR:", err);
    res.status(500).json({ error: err.message });
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

app.get("/api/prices", (req, res) => {
  try {
    console.log("API HIT: /api/prices");
    const db = getDb();
    const { conditions, params } = buildRouteFilters(req.query);
    const rows = db
      .prepare(
        `
          SELECT
            id,
            pickup_date,
            dropoff_date,
            location,
            COALESCE(pickup_location, location) AS pickup_location,
            COALESCE(dropoff_location, location) AS dropoff_location,
            company,
            vehicle,
            price,
            scrape_date,
            type
          FROM pricing_data
          ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        `
      )
      .all(...params);
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
            l.scrape_date,
            l.type
          FROM latest_rows_with_route l
          ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        `
      )
      .all(...params);
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

    for (const key of allowedFilters) {
      const value = req.query[key];
      if (typeof value === "string" && value.trim() !== "") {
        conditions.push(`${key} = ?`);
        params.push(value.trim());
      }
    }

    const query = `
        SELECT
          pickup_date,
          dropoff_date,
          location,
          COALESCE(pickup_location, location) AS pickup_location,
          COALESCE(dropoff_location, location) AS dropoff_location,
          company,
          vehicle,
          price,
          scrape_date,
          type
        FROM pricing_data
        ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        ;
      `;

    const rows = db.prepare(query).all(...params);
    res.json(normalizeVehicleRows(rows));
  } catch (err) {
    console.error("TRENDS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  getDb();
  console.log("SERVER STARTED SUCCESSFULLY");
  console.log(`API listening on http://localhost:${port}`);
});
