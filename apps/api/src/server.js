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

app.get("/api/prices", (req, res) => {
  try {
    console.log("API HIT: /api/prices");
    const db = getDb();
    const rows = db.prepare("SELECT * FROM pricing_data;").all();
    res.json(rows);
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
          SELECT p.*
          FROM pricing_data p
          JOIN (
            SELECT
              pickup_date,
              dropoff_date,
              location,
              company,
              vehicle,
              type,
              MAX(scrape_date) AS max_scrape_date
            FROM pricing_data
            GROUP BY pickup_date, dropoff_date, location, company, vehicle, type
          ) latest
            ON p.pickup_date = latest.pickup_date
           AND p.dropoff_date = latest.dropoff_date
           AND p.location = latest.location
           AND p.company = latest.company
           AND p.vehicle = latest.vehicle
           AND p.type = latest.type
           AND p.scrape_date = latest.max_scrape_date
        `
      )
      .all();
    res.json(rows);
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
