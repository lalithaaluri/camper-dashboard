const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "pricing.db");

let db = null;

const initializeSchema = (database) => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS pricing_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pickup_date TEXT,
      dropoff_date TEXT,
      -- TODO(cross-location): replace single location with pickup_location + dropoff_location.
      location TEXT,
      company TEXT,
      vehicle TEXT,
      price REAL,
      website_daily_rate REAL,
      scrape_date TEXT,
      type TEXT
    );
  `);

  const columns = database.prepare(`PRAGMA table_info(pricing_data)`).all();
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("pickup_location")) {
    database.exec(`ALTER TABLE pricing_data ADD COLUMN pickup_location TEXT`);
  }
  if (!columnNames.has("dropoff_location")) {
    database.exec(`ALTER TABLE pricing_data ADD COLUMN dropoff_location TEXT`);
  }
  if (!columnNames.has("website_daily_rate")) {
    database.exec(`ALTER TABLE pricing_data ADD COLUMN website_daily_rate REAL`);
  }
};

const getDb = () => {
  if (db) {
    return db;
  }

  fs.mkdirSync(dataDir, { recursive: true });
  console.log("API DB PATH:", dbPath);
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 10000");
  initializeSchema(db);
  return db;
};

module.exports = {
  dbPath,
  getDb
};
