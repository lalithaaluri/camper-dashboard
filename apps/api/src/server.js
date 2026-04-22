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
      .prepare("SELECT MAX(scrape_date) AS latest_scrape_date FROM pricing_data;")
      .get();

    res.json({
      latest_scrape_date: result?.latest_scrape_date ?? null
    });
  } catch (err) {
    console.error("LATEST SCRAPE DATE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/prices", async (req, res) => {
  try {
    console.log("API HIT: /api/prices");
    const db = getDb();
    const vehicle =
      typeof req.query.vehicle === "string" && req.query.vehicle.trim() !== ""
        ? req.query.vehicle.trim()
        : null;
    const location =
      typeof req.query.location === "string" && req.query.location.trim() !== ""
        ? req.query.location.trim()
        : null;
    const pickupDate =
      typeof req.query.pickup_date === "string" && req.query.pickup_date.trim() !== ""
        ? req.query.pickup_date.trim()
        : null;
    const dropoffDate =
      typeof req.query.dropoff_date === "string" && req.query.dropoff_date.trim() !== ""
        ? req.query.dropoff_date.trim()
        : null;

    const query = `
      SELECT
        pickup_date,
        dropoff_date,
        location,
        company,
        vehicle,
        price,
        type,
        scrape_date
      FROM (
        SELECT
          *,
          ROW_NUMBER() OVER (
            PARTITION BY pickup_date, dropoff_date, vehicle, location, company
            ORDER BY scrape_date DESC
          ) AS rn
        FROM pricing_data
        WHERE 1=1
          AND (? IS NULL OR vehicle = ?)
          AND (? IS NULL OR location = ?)
          AND (? IS NULL OR pickup_date = ?)
          AND (? IS NULL OR dropoff_date = ?)
      ) t
      WHERE rn = 1
      ;
    `;

    const rows = db.prepare(query).all(
      vehicle,
      vehicle,
      location,
      location,
      pickupDate,
      pickupDate,
      dropoffDate,
      dropoffDate
    );
    res.json(rows);
  } catch (err) {
    console.error("PRICES ERROR:", err);
    res.status(500).json({ error: err.message });
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
    res.json(rows);
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
