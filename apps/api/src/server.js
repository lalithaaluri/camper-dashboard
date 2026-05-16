const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
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
const dashboardAuthUser = (process.env.DASHBOARD_AUTH_USER || "").trim();
const dashboardAuthPassword = (process.env.DASHBOARD_AUTH_PASSWORD || "").trim();
const dashboardAuthPasswordHash = (process.env.DASHBOARD_AUTH_PASSWORD_HASH || "").trim();
const dashboardSessionSecret = (process.env.DASHBOARD_SESSION_SECRET || "").trim();
const DASHBOARD_SESSION_COOKIE = "camper_dashboard_session";
const SCRYPT_HASH_PREFIX = "scrypt$";
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_RATE_MAX_ATTEMPTS = 10;
const LOGIN_RATE_BLOCK_MS = 15 * 60 * 1000;
const loginStateByIp = new Map();
const sessionsById = new Map();

const buildNormalizedDateSql = (columnExpression) => `
  CASE
    WHEN ${columnExpression} GLOB '????-??-??' THEN ${columnExpression}
    WHEN ${columnExpression} LIKE '%/%/%' THEN
      printf(
        '%04d-%02d-%02d',
        CAST(substr(substr(${columnExpression}, instr(${columnExpression}, '/') + 1), instr(substr(${columnExpression}, instr(${columnExpression}, '/') + 1), '/') + 1) AS INTEGER),
        CAST(substr(${columnExpression}, 1, instr(${columnExpression}, '/') - 1) AS INTEGER),
        CAST(substr(substr(${columnExpression}, instr(${columnExpression}, '/') + 1), 1, instr(substr(${columnExpression}, instr(${columnExpression}, '/') + 1), '/') - 1) AS INTEGER)
      )
    ELSE NULL
  END
`;
const NORMALIZED_SCRAPE_DATE_SQL = buildNormalizedDateSql("scrape_date");
const NORMALIZED_PICKUP_DATE_SQL = buildNormalizedDateSql("pickup_date");
const NORMALIZED_DROPOFF_DATE_SQL = buildNormalizedDateSql("dropoff_date");

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

const dashboardSessionTtlHours =
  parsePositiveInt(process.env.DASHBOARD_SESSION_TTL_HOURS, { min: 1, max: 168 }) || 24;
const dashboardSessionTtlMs = dashboardSessionTtlHours * 60 * 60 * 1000;
const dashboardAuthEnabled = Boolean(
  dashboardAuthUser && (dashboardAuthPassword || dashboardAuthPasswordHash) && dashboardSessionSecret
);

const parseCookieHeader = (cookieHeader) => {
  const values = {};

  String(cookieHeader || "")
    .split(";")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) {
        return;
      }

      const key = entry.slice(0, separatorIndex).trim();
      const rawValue = entry.slice(separatorIndex + 1).trim();
      try {
        values[key] = decodeURIComponent(rawValue);
      } catch {
        values[key] = rawValue;
      }
    });

  return values;
};

const safeCompare = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const hashWithScrypt = (password, salt) =>
  crypto.scryptSync(password, salt, 64).toString("hex");

const verifyPasswordHash = (password, encodedHash) => {
  const value = String(encodedHash || "");
  if (!value.startsWith(SCRYPT_HASH_PREFIX)) {
    return false;
  }

  const parts = value.split("$");
  if (parts.length !== 3) {
    return false;
  }

  const salt = parts[1];
  const expected = parts[2];
  if (!salt || !expected) {
    return false;
  }

  const actual = hashWithScrypt(password, salt);
  return safeCompare(actual, expected);
};

const verifyDashboardPassword = (password) => {
  const submittedPassword = String(password || "");

  if (dashboardAuthPasswordHash) {
    return verifyPasswordHash(submittedPassword, dashboardAuthPasswordHash);
  }

  if (!dashboardAuthPassword) {
    return false;
  }

  return safeCompare(submittedPassword, dashboardAuthPassword);
};

const getSecureRequest = (request) => {
  const forwardedProto = String(request.get("x-forwarded-proto") || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  return request.secure || forwardedProto === "https";
};

const buildSessionCookieOptions = (request) => {
  const secureRequest = getSecureRequest(request);
  return {
    httpOnly: true,
    secure: secureRequest,
    sameSite: secureRequest ? "none" : "lax",
    path: "/",
    maxAge: dashboardSessionTtlMs
  };
};

const signSessionId = (sessionId) =>
  crypto
    .createHmac("sha256", dashboardSessionSecret)
    .update(sessionId)
    .digest("base64url");

const encodeSessionCookie = (sessionId) => `${sessionId}.${signSessionId(sessionId)}`;

const decodeSessionCookie = (cookieValue) => {
  if (!cookieValue) {
    return null;
  }

  const trimmed = String(cookieValue).trim();
  const separatorIndex = trimmed.lastIndexOf(".");
  if (separatorIndex <= 0) {
    return null;
  }

  const sessionId = trimmed.slice(0, separatorIndex);
  const signature = trimmed.slice(separatorIndex + 1);
  if (!sessionId || !signature) {
    return null;
  }

  const expectedSignature = signSessionId(sessionId);
  if (!safeCompare(expectedSignature, signature)) {
    return null;
  }

  return sessionId;
};

const pruneExpiredSessions = () => {
  const now = Date.now();
  for (const [sessionId, session] of sessionsById.entries()) {
    if (!session || session.expiresAt <= now) {
      sessionsById.delete(sessionId);
    }
  }
};

const resolveSession = (request) => {
  if (!dashboardAuthEnabled) {
    return null;
  }

  pruneExpiredSessions();
  const cookies = parseCookieHeader(request.headers.cookie);
  const signedCookieValue = cookies[DASHBOARD_SESSION_COOKIE];
  const sessionId = decodeSessionCookie(signedCookieValue);
  if (!sessionId) {
    return null;
  }

  const session = sessionsById.get(sessionId);
  if (!session || session.expiresAt <= Date.now()) {
    sessionsById.delete(sessionId);
    return null;
  }

  return {
    sessionId,
    ...session
  };
};

const getClientIp = (request) => {
  const forwardedFor = String(request.get("x-forwarded-for") || "")
    .split(",")[0]
    .trim();
  return forwardedFor || request.ip || "unknown";
};

const getLoginState = (ip) => {
  const now = Date.now();
  const current = loginStateByIp.get(ip);

  if (!current || now - current.windowStart > LOGIN_RATE_WINDOW_MS) {
    const fresh = { windowStart: now, attempts: 0, blockedUntil: 0 };
    loginStateByIp.set(ip, fresh);
    return fresh;
  }

  return current;
};

const markFailedLogin = (ip) => {
  const state = getLoginState(ip);
  state.attempts += 1;
  if (state.attempts >= LOGIN_RATE_MAX_ATTEMPTS) {
    state.blockedUntil = Date.now() + LOGIN_RATE_BLOCK_MS;
  }
};

const clearFailedLogins = (ip) => {
  loginStateByIp.delete(ip);
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

const corsOptions = {
  credentials: true,
  origin(origin, callback) {
    if (!origin || isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("CORS origin not allowed"));
  }
};

app.set("trust proxy", 1);
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
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

const clearDashboardSessionCookie = (request, response) => {
  const options = buildSessionCookieOptions(request);
  response.clearCookie(DASHBOARD_SESSION_COOKIE, {
    httpOnly: true,
    secure: options.secure,
    sameSite: options.sameSite,
    path: "/"
  });
};

const requireDashboardSession = (req, res, next) => {
  if (!dashboardAuthEnabled) {
    return next();
  }

  const session = resolveSession(req);
  if (!session) {
    return res.status(401).json({ error: "Authentication required" });
  }

  req.dashboardUser = session.user;
  return next();
};

app.get("/api/auth/config", (_req, res) => {
  res.json({
    authEnabled: dashboardAuthEnabled,
    usernameHint: dashboardAuthEnabled ? dashboardAuthUser : null,
    sessionTtlHours: dashboardAuthEnabled ? dashboardSessionTtlHours : null
  });
});

app.get("/api/auth/session", (req, res) => {
  if (!dashboardAuthEnabled) {
    res.json({
      authenticated: true,
      authEnabled: false,
      usernameHint: null
    });
    return;
  }

  const session = resolveSession(req);
  if (!session) {
    res.status(401).json({
      authenticated: false,
      authEnabled: true,
      usernameHint: dashboardAuthUser
    });
    return;
  }

  res.json({
    authenticated: true,
    authEnabled: true,
    usernameHint: dashboardAuthUser,
    user: session.user
  });
});

app.post("/api/auth/login", (req, res) => {
  if (!dashboardAuthEnabled) {
    res.json({ ok: true, authEnabled: false });
    return;
  }

  const ip = getClientIp(req);
  const rateState = getLoginState(ip);
  if (rateState.blockedUntil > Date.now()) {
    const retryAfterSeconds = Math.ceil((rateState.blockedUntil - Date.now()) / 1000);
    res
      .status(429)
      .set("Retry-After", String(retryAfterSeconds))
      .json({ error: "Too many login attempts. Please try again later." });
    return;
  }

  const submittedUser = String(req.body?.username || "").trim();
  const submittedPassword = String(req.body?.password || "");
  const userMatches = safeCompare(submittedUser, dashboardAuthUser);
  const passwordMatches = verifyDashboardPassword(submittedPassword);

  if (!userMatches || !passwordMatches) {
    markFailedLogin(ip);
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  clearFailedLogins(ip);

  const sessionId = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + dashboardSessionTtlMs;
  sessionsById.set(sessionId, {
    user: dashboardAuthUser,
    expiresAt
  });

  res.cookie(
    DASHBOARD_SESSION_COOKIE,
    encodeSessionCookie(sessionId),
    buildSessionCookieOptions(req)
  );
  res.json({
    ok: true,
    user: dashboardAuthUser,
    expiresAt: new Date(expiresAt).toISOString()
  });
});

app.post("/api/auth/logout", (req, res) => {
  const cookies = parseCookieHeader(req.headers.cookie);
  const signedCookieValue = cookies[DASHBOARD_SESSION_COOKIE];
  const sessionId = decodeSessionCookie(signedCookieValue);
  if (sessionId) {
    sessionsById.delete(sessionId);
  }

  clearDashboardSessionCookie(req, res);
  res.json({ ok: true });
});

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

app.get("/api/latest-scrape-date", requireDashboardSession, (req, res) => {
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

app.get("/api/stats", requireDashboardSession, (req, res) => {
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

app.get("/api/prices", requireDashboardSession, (req, res) => {
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

app.get("/api/prices/latest", requireDashboardSession, (req, res) => {
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
              LOWER(TRIM(COALESCE(p.pickup_location, p.location))) AS pickup_location_key,
              LOWER(TRIM(COALESCE(p.dropoff_location, p.location))) AS dropoff_location_key,
              LOWER(TRIM(COALESCE(p.company, ''))) AS company_key,
              LOWER(TRIM(COALESCE(p.vehicle, ''))) AS vehicle_key,
              ${NORMALIZED_PICKUP_DATE_SQL} AS pickup_date_key,
              ${NORMALIZED_DROPOFF_DATE_SQL} AS dropoff_date_key,
              ${NORMALIZED_SCRAPE_DATE_SQL} AS scrape_date_key
            FROM pricing_data p
          ),
          latest_elements AS (
            SELECT
              n.*,
              ROW_NUMBER() OVER (
                PARTITION BY
                  n.pickup_date_key,
                  n.dropoff_date_key,
                  n.pickup_location_key,
                  n.dropoff_location_key,
                  n.company_key,
                  n.vehicle_key
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
                  n.pickup_date_key,
                  n.dropoff_date_key,
                  n.pickup_location_key,
                  n.dropoff_location_key,
                  n.company_key,
                  n.vehicle_key
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
              AND l.pickup_date_key IN (
                SELECT pickup_date_key
                FROM latest_rows_with_route
                WHERE pickup_date_key IS NOT NULL
                GROUP BY pickup_date_key
                ORDER BY pickup_date_key DESC
                LIMIT ?
              )` : ""}
          )
          SELECT
            l.id,
            COALESCE(l.pickup_date_key, l.pickup_date) AS pickup_date,
            COALESCE(l.dropoff_date_key, l.dropoff_date) AS dropoff_date,
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

app.get("/api/trends", requireDashboardSession, async (req, res) => {
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
