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
    const rows = db.prepare("SELECT * FROM pricing_data;").all();
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
    const rows = db
      .prepare(
        `
          WITH normalized AS (
            SELECT
              p.*,
              ${NORMALIZED_SCRAPE_DATE_SQL} AS scrape_date_key
            FROM pricing_data p
          )
          SELECT n.*
          FROM normalized n
          JOIN (
            SELECT
              pickup_date,
              dropoff_date,
              location,
              company,
              vehicle,
              type,
              MAX(scrape_date_key) AS max_scrape_date
            FROM normalized
            GROUP BY pickup_date, dropoff_date, location, company, vehicle, type
          ) latest
            ON n.pickup_date = latest.pickup_date
           AND n.dropoff_date = latest.dropoff_date
           AND n.location = latest.location
           AND n.company = latest.company
           AND n.vehicle = latest.vehicle
           AND n.type = latest.type
           AND n.scrape_date_key = latest.max_scrape_date
        `
      )
      .all();
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
    const conditions = [];
    const params = [];
    const allowedFilters = ["vehicle", "location"];

    for (const key of allowedFilters) {
      const value = req.query[key];
      if (typeof value === "string" && value.trim() !== "") {
        conditions.push(`${key} = ?`);
        params.push(value.trim());
      }
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const query = `
      SELECT
        pickup_date,
        dropoff_date,
        location,
        company,
        vehicle,
        price,
        scrape_date,
        type
      FROM pricing_data
      ${whereClause}
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
