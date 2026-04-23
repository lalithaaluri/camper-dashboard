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
      location TEXT,
      company TEXT,
      vehicle TEXT,
      price REAL,
      scrape_date TEXT,
      type TEXT
    );
  `);
};

const getDb = () => {
  if (db) {
    return db;
  }

  fs.mkdirSync(dataDir, { recursive: true });
  console.log("API DB PATH:", dbPath);
  db = new Database(dbPath);
  initializeSchema(db);
  return db;
};

module.exports = {
  dbPath,
  getDb
};
