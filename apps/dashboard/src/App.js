import { useEffect, useMemo, useRef, useState } from "react";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { curveMonotoneX } from "@visx/curve";
import { LinearGradient } from "@visx/gradient";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { scaleBand, scaleLinear, scalePoint } from "@visx/scale";
import { Bar, LinePath } from "@visx/shape";
import { Text } from "@visx/text";
import "./App.css";

const SCRAPER_API_BASE =
  process.env.REACT_APP_SCRAPER_API_URL || "http://localhost:4301";
const PRICING_API_BASE =
  process.env.REACT_APP_PRICING_API_URL || "http://localhost:4302";

const vehicleConfigs = {
  "trek budget": {
    label: "Trek Budget Camper",
    shortLabel: "Budget",
    competitorVehicles: [ "travellersautobarnstationwagon" ],
    elementsVehicles: ["trek budget"],
    narrative: "Entry-level two-berth trips and budget-led weekend demand."
  },
  "trek medium": {
    label: "Trek Medium Camper",
    shortLabel: "Medium",
    competitorVehicles: [ "happycamperssleeper" ],
    elementsVehicles: ["trek medium"],
    narrative: "Flexible mid-tier touring with balanced comfort and value."
  },
  "trek large": {
    label: "Trek Large Camper",
    shortLabel: "Large",
    competitorVehicles: [ "campervanvillageaventus2" ],
    elementsVehicles: ["trek large"],
    narrative: "Higher-capacity configuration for longer family routes."
  },
  tandem: {
    label: "Tandem",
    shortLabel: "Tandem",
    competitorVehicles: ["beta2s"],
    elementsVehicles: ["tandem"],
    narrative: "Compact touring configuration for flexible couples itineraries."
  },
  tandemdeluxe: {
    label: "Tandem Deluxe",
    shortLabel: "Deluxe",
    competitorVehicles: ["deuce"],
    elementsVehicles: ["tandemdeluxe"],
    narrative: "Upgraded compact touring with comfort-led pricing headroom."
  },
  quad: {
    label: "Quad",
    shortLabel: "Quad",
    competitorVehicles: ["doubledown", "highball", "delite", "condo", "rover"],
    elementsVehicles: ["quad"],
    narrative: "Family-sized fleet where spread control matters most."
  },
  sixer: {
    label: "Sixer",
    shortLabel: "Sixer",
    competitorVehicles: ["bigsix", "doubleup"],
    elementsVehicles: ["sixer"],
    narrative: "High-capacity family and group journeys with premium price ranges."
  }
};

const locationOptions = [
  { value: "", label: "All depots" },
  { value: "auckland", label: "Auckland" },
  { value: "christchurch", label: "Christchurch" }
];
const routeLocationOptions = [
  { value: "", label: "Same as Pick Up" },
  { value: "auckland", label: "Auckland" },
  { value: "christchurch", label: "Christchurch" }
];
const scrapeRouteOptions = [
  {
    value: "auckland->auckland",
    label: "Auckland -> Auckland",
    locations: ["auckland"]
  },
  {
    value: "christchurch->christchurch",
    label: "Christchurch -> Christchurch",
    locations: ["christchurch"]
  },
  {
    value: "auckland->christchurch",
    label: "Auckland -> Christchurch",
    locations: ["auckland", "christchurch"]
  },
  {
    value: "christchurch->auckland",
    label: "Christchurch -> Auckland",
    locations: ["christchurch", "auckland"]
  }
];

const initialDashboard = {
  summary: {
    lowest: null,
    average: null,
    highest: null,
    cheapestRow: null,
    highestRow: null,
    elements: null,
    recommended: null,
    recommendedDailyRate: null,
    spread: null,
    upliftValue: null,
    upliftPercent: 0,
    recommendationSource: null,
    competitorCount: 0,
    trackedDates: 0,
    observedQuotes: 0
  },
  trend: [],
  latestRows: [],
  companyStats: [],
  latestDate: "",
  latestDateLabel: "No snapshot yet"
};

const initialScraperStatus = {
  ok: false,
  activeRunId: null,
  latestRun: null,
  dataset: {
    rowCount: 0,
    latestPickupDate: null,
    latestScrapeDate: null
  },
  error: ""
};

const normalize = (value) =>
  String(value || "").toLowerCase().replace(/\s+/g, "");

function normalizeVehicleKey(v) {
  return String(v || "").toLowerCase().replace(/\s+/g, "");
}

function normalizeVehicle(v) {
  if (!v) return "";
  v = String(v).toLowerCase();

  if (v.includes("budget")) return "trek budget";
  if (v.includes("medium")) return "trek medium";
  if (v.includes("large")) return "trek large";

  const compact = v.replace(/\s+/g, "");
  if (compact.includes("tandemdeluxe")) return "tandemdeluxe";
  if (compact.includes("tandem")) return "tandem";
  if (compact.includes("quad")) return "quad";
  if (compact.includes("bigsix")) return "bigsix";
  if (compact.includes("doubleup")) return "doubleup";
  if (compact.includes("sixer")) return "sixer";

  if (compact.includes("stationwagen") || compact.includes("stationwagon")) return "stationwagen";
  if (compact.includes("sleeper")) return "sleeper";
  if (compact.includes("aventus")) return "aventus2";

  if (compact.includes("beta")) return "beta2s";
  if (compact.includes("deuce")) return "deuce";
  if (compact.includes("doubledown")) return "doubledown";
  if (compact.includes("highball")) return "highball";
  if (compact.includes("delite")) return "delite";
  if (compact.includes("condo")) return "condo";
  if (compact.includes("rover")) return "rover";
  return v.trim().replace(/\s+/g, " ");
}

const normalizeVehicleMatch = (value) => normalizeVehicle(value);
const normalizeVehicleName = (name) => normalizeVehicle(name);
const isValidCompetitorPriceRow = (row) =>
  Number.isFinite(Number(row?.price)) && Number(row.price) > 10;

const matchesCompetitorRouteSelection = (
  row,
  { selectedPickupLocation = "", selectedDropoffLocation = "", selectedLocation = "" } = {}
) => {
  const selectedPickup = normalize(selectedPickupLocation || selectedLocation || "");
  const selectedDropoff = normalize(
    selectedDropoffLocation || selectedPickupLocation || selectedLocation || ""
  );

  if (!selectedPickup && !selectedDropoff) {
    return true;
  }

  const rowPickup = normalize(row.pickupLocation || row.location);
  const rowDropoff = normalize(row.dropoffLocation || row.location);
  const rowLocation = normalize(row.location);
  const hasExplicitPickup = Boolean(row.hasExplicitPickupLocation);
  const hasExplicitDropoff = Boolean(row.hasExplicitDropoffLocation);
  const isSameLocationSelection =
    Boolean(selectedPickup) && Boolean(selectedDropoff) && selectedPickup === selectedDropoff;

  if (isSameLocationSelection) {
    const explicitSameLocationMatch =
      hasExplicitPickup &&
      hasExplicitDropoff &&
      rowPickup === selectedPickup &&
      rowDropoff === selectedDropoff;
    const legacySameLocationMatch =
      !hasExplicitPickup &&
      !hasExplicitDropoff &&
      rowLocation === selectedPickup;

    return explicitSameLocationMatch || legacySameLocationMatch;
  }

  return (
    hasExplicitPickup &&
    hasExplicitDropoff &&
    rowPickup === selectedPickup &&
    rowDropoff === selectedDropoff
  );
};

const buildCanonicalTripKey = (row) =>
  [
    row.dateKey,
    row.dropoffDateKey,
    row.pickupLocation || row.location,
    row.dropoffLocation || row.location
  ].join("|");

const rowMatchesSelectedRawTripLineage = (row, selectedPickupDate, selectedDropoffDate) =>
  String(row?.rawPickupDate || "").trim() === String(selectedPickupDate || "").trim() &&
  String(row?.rawDropoffDate || "").trim() === String(selectedDropoffDate || "").trim();

function formatDateDMY(dateStr) {
  if (!dateStr) return "";

  if (dateStr.includes("-")) {
    const [year, month, day] = dateStr.split("-");
    return `${day}/${month}/${year}`;
  }

  if (dateStr.includes("/")) {
    const [month, day, year] = dateStr.split("/");
    return `${day}/${month}/${year}`;
  }

  return dateStr;
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return "";
  const normalized = toDateKey(dateStr);
  if (!normalized) return String(dateStr);
  const [year, month, day] = normalized.split("-");
  return `${day}/${month}/${year}`;
}

function normalizeInputDate(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const isoDate = `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    const parsed = parseDate(isoDate);
    return parsed ? toDateKey(parsed) : "";
  }

  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]);
    const year = Number(slashMatch[3]);
    const isoDate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(
      day
    ).padStart(2, "0")}`;
    const parsed = parseDate(isoDate);
    if (!parsed) {
      return "";
    }
    const parsedYear = parsed.getFullYear();
    const parsedMonth = parsed.getMonth() + 1;
    const parsedDay = parsed.getDate();
    if (parsedYear !== year || parsedMonth !== month || parsedDay !== day) {
      return "";
    }
    return toDateKey(parsed);
  }

  return "";
}

const parseDate = (value) => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) {
      return value;
    }
    return null;
  }

  const normalizeInternalDate = (raw, { preferDayFirst = false } = {}) => {
    const trimmed = String(raw || "").trim();
    if (!trimmed) {
      return "";
    }

    const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }

    const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!slashMatch) {
      return "";
    }

    const first = Number(slashMatch[1]);
    const second = Number(slashMatch[2]);
    const year = slashMatch[3];

    let day = first;
    let month = second;

    // Ambiguous slash dates: keep UI day-first, otherwise infer from value ranges.
    if (!preferDayFirst) {
      if (first > 12 && second <= 12) {
        day = first;
        month = second;
      } else if (second > 12 && first <= 12) {
        month = first;
        day = second;
      } else {
        // API legacy values are month/day/year when ambiguous.
        month = first;
        day = second;
      }
    }

    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };

  const normalized = normalizeInternalDate(value, { preferDayFirst: true });
  if (normalized) {
    const normalizedDate = new Date(`${normalized}T00:00:00`);
    if (!Number.isNaN(normalizedDate.getTime())) {
      return normalizedDate;
    }
  }

  const nativeDate = new Date(String(value));
  if (!Number.isNaN(nativeDate.getTime())) {
    return nativeDate;
  }

  return null;
};

const toDateKey = (value) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }

    const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      const first = Number(slashMatch[1]);
      const second = Number(slashMatch[2]);
      const year = slashMatch[3];

      let day = first;
      let month = second;

      if (!(first > 12 && second <= 12)) {
        if (second > 12 && first <= 12) {
          month = first;
          day = second;
        } else {
          // API legacy ambiguity defaults to month/day/year.
          month = first;
          day = second;
        }
      }

      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const date = value instanceof Date ? value : parseDate(value);
  if (!date) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatDate = (date) => toDateKey(date);

const formatCurrency = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "No data";
  }

  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
    maximumFractionDigits: 0
  }).format(value);
};

const formatPercentValue = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "0%";
  }

  return `${Number.parseFloat(Math.abs(value).toFixed(1))}%`;
};

export const compareScrapeDates = (left, right) => {
  const leftTime = left instanceof Date ? left.getTime() : Number.NEGATIVE_INFINITY;
  const rightTime = right instanceof Date ? right.getTime() : Number.NEGATIVE_INFINITY;
  return leftTime - rightTime;
};

const compareRowFreshness = (left, right) => {
  const dateDiff = compareScrapeDates(left?.scrapeDate, right?.scrapeDate);
  if (dateDiff !== 0) {
    return dateDiff;
  }

  const leftId = Number.isFinite(Number(left?.id)) ? Number(left.id) : Number.NEGATIVE_INFINITY;
  const rightId = Number.isFinite(Number(right?.id)) ? Number(right.id) : Number.NEGATIVE_INFINITY;
  return leftId - rightId;
};

export const selectLatestCompetitorRows = (rows) => {
  const latestByKey = new Map();

  rows.forEach((row) => {
    const key = [
      row.dateKey,
      row.dropoffDateKey,
      row.pickupLocation || row.location,
      row.dropoffLocation || row.location,
      row.company,
      normalizeVehicleName(row.vehicle)
    ].join("|");
    const current = latestByKey.get(key);

    if (!current || compareRowFreshness(row, current) >= 0) {
      latestByKey.set(key, row);
    }
  });

  return Array.from(latestByKey.values());
};

export const selectLatestRowsBySnapshot = (rows) => {
  const latestByKey = new Map();

  rows.forEach((row) => {
    const key = [
      row.dateKey,
      row.dropoffDate,
      row.pickupLocation || row.location,
      row.dropoffLocation || row.location,
      row.company,
      row.vehicle,
      row.type,
      row.tripDays ?? ""
    ].join("|");
    const current = latestByKey.get(key);

    if (!current || compareScrapeDates(row.scrapeDate, current.scrapeDate) >= 0) {
      latestByKey.set(key, row);
    }
  });

  return Array.from(latestByKey.values());
};

const buildDuplicateQuoteKey = (row) =>
  [
    row.company,
    normalizeVehicleName(row.vehicle),
    row.dateKey,
    row.dropoffDateKey,
    row.pickupLocation || row.location,
    row.dropoffLocation || row.location,
    row.price
  ].join("|");

const dedupeQuoteRows = (rows) => {
  const seen = new Set();

  return rows.filter((row) => {
    const key = buildDuplicateQuoteKey(row);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const getRowDurationDays = (row) => {
  const pickupDateKey = row?.dateKey || toDateKey(row?.pickupDate || row?.pickup_date || "");
  const dropoffDateKey = row?.dropoffDateKey || toDateKey(row?.dropoffDate || row?.dropoff_date || "");

  if (!pickupDateKey || !dropoffDateKey) {
    return null;
  }

  return calculateTripDays(parseDate(pickupDateKey), parseDate(dropoffDateKey));
};

const calculateDailyRate = (price, durationDays) => {
  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice)) {
    return null;
  }
  if (!Number.isFinite(durationDays) || durationDays <= 0) {
    return null;
  }
  return Math.round(numericPrice / durationDays);
};

const resolveTrendDailyRate = (row) => {
  const apiDailyRate = Number(row?.daily_rate ?? row?.apiDailyRate);
  if (Number.isFinite(apiDailyRate) && apiDailyRate > 0) {
    return Math.round(apiDailyRate);
  }

  const durationDays =
    Number(row?.duration_days) ||
    Number(row?.durationDays) ||
    getRowDurationDays(row);
  const computed = calculateDailyRate(row?.price, durationDays);
  return Number.isFinite(computed) && computed > 0 ? Math.round(computed) : null;
};

const getBaselinePrice = (cheapestCompetitorPrice, elementsPrice) => {
  const hasCheapestCompetitor =
    cheapestCompetitorPrice !== null &&
    cheapestCompetitorPrice !== undefined &&
    !Number.isNaN(cheapestCompetitorPrice);
  const hasElementsPrice =
    elementsPrice !== null &&
    elementsPrice !== undefined &&
    !Number.isNaN(elementsPrice);

  if (hasCheapestCompetitor && !hasElementsPrice) {
    return {
      baselinePrice: cheapestCompetitorPrice,
      source: "competitor"
    };
  }

  if (hasCheapestCompetitor) {
    return {
      baselinePrice: cheapestCompetitorPrice,
      source: "competitor"
    };
  }

  if (hasElementsPrice) {
    return {
      baselinePrice: elementsPrice,
      source: "elements"
    };
  }

  return {
    baselinePrice: null,
    source: null
  };
};

export const getMappedCompetitors = (selectedVehicle = "") =>
  (vehicleConfigs[normalizeVehicle(selectedVehicle)]?.competitorVehicles || []).map((entry) =>
    normalize(entry)
  );

export const buildCompetitorQuoteSnapshot = ({
  rows,
  selectedPickup = "",
  selectedDropoff = "",
  selectedVehicle = "",
  selectedLocation = "",
  selectedPickupLocation = "",
  selectedDropoffLocation = ""
}) => {
  const competitors = getMappedCompetitors(selectedVehicle);
  const filteredRows = rows.filter((row) => {
    if (normalize(row.company) === "elementsworld") {
      return false;
    }

    const normalizedVehicle = normalizeVehicle(row.vehicle);
    const normalizedSelectedVehicle = normalizeVehicle(selectedVehicle);
    const rowVehicleKey = normalizeVehicleKey(row.vehicle);
    const selectedVehicleKey = normalizeVehicleKey(selectedVehicle);
    const competitorLookup = normalize(`${row.company} ${normalizedVehicle}`);
    const competitorVehicleOnlyLookup = normalize(normalizedVehicle);
    const isMappedCompetitor = competitors.some(
      (competitorToken) =>
        competitorLookup.includes(competitorToken) ||
        competitorVehicleOnlyLookup.includes(competitorToken)
    );
    const matchesSelectedVehicle =
      !normalizedSelectedVehicle ||
      rowVehicleKey === selectedVehicleKey ||
      isMappedCompetitor;

    if (!matchesSelectedVehicle) {
      return false;
    }

    if (
      competitors.length &&
      rowVehicleKey !== selectedVehicleKey &&
      !isMappedCompetitor
    ) {
      return false;
    }

    if (selectedPickup && row.dateKey !== selectedPickup) {
      return false;
    }

    if (selectedDropoff && row.dropoffDateKey !== selectedDropoff) {
      return false;
    }

    if (
      !matchesCompetitorRouteSelection(row, {
        selectedPickupLocation,
        selectedDropoffLocation,
        selectedLocation
      })
    ) {
      return false;
    }

    return true;
  });
  const latestCompetitorRows = selectLatestCompetitorRows(filteredRows);
  const latestScrapeDate = latestCompetitorRows.reduce((latest, row) => {
    if (!(row.scrapeDate instanceof Date) || Number.isNaN(row.scrapeDate.getTime())) {
      return latest;
    }

    if (!latest || compareScrapeDates(row.scrapeDate, latest) > 0) {
      return row.scrapeDate;
    }

    return latest;
  }, null);
  const validCompetitorRows = latestCompetitorRows.filter(isValidCompetitorPriceRow);
  const quoteRows = dedupeQuoteRows(validCompetitorRows)
    .map((row) => {
      const durationDays = getRowDurationDays(row);
      const dailyRate = calculateDailyRate(row.price, durationDays);

      return {
        ...row,
        normalizedVehicle: normalizeVehicleName(row.vehicle),
        durationDays,
        dailyRate
      };
    })
    .sort((left, right) => Number(left.dailyRate ?? Infinity) - Number(right.dailyRate ?? Infinity));
  const competitorPrices = quoteRows
    .map((row) => Number(row.dailyRate))
    .filter((price) => Number.isFinite(price));
  const average =
    competitorPrices.length > 0 ? averageFrom(competitorPrices) : null;
  const cheapestRow = quoteRows.length ? quoteRows[0] : null;
  const highestRow = quoteRows.length ? quoteRows[quoteRows.length - 1] : null;
  const companyMap = quoteRows.reduce((accumulator, row) => {
    const current = accumulator.get(row.company) || {
      company: row.company,
      prices: [],
      vehicles: new Set()
    };

    current.prices.push(row.price);
    current.vehicles.add(row.vehicle);
    accumulator.set(row.company, current);
    return accumulator;
  }, new Map());
  const companyStats = Array.from(companyMap.values())
    .map((entry) => ({
      company: entry.company,
      average: averageFrom(entry.prices),
      vehicles: Array.from(entry.vehicles).join(", "),
      count: entry.prices.length
    }))
    .sort((left, right) => left.average - right.average);

  return {
    latestCompetitorRows: quoteRows,
    rows: quoteRows,
    companyStats,
    latestScrapeDate,
    summary: {
      lowest: cheapestRow ? cheapestRow.dailyRate : null,
      average,
      highest: highestRow ? highestRow.dailyRate : null,
      cheapestRow,
      highestRow,
      competitorCount: quoteRows.length
    }
  };
};

export const buildQuoteTableRows = ({
  elementsRow = null,
  competitorRows = []
}) => {
  const finalRows = [];

  if (elementsRow) {
    const durationDays = getRowDurationDays(elementsRow);
    finalRows.push({
      ...elementsRow,
      isElements: true,
      normalizedVehicle: normalizeVehicleName(elementsRow.vehicle),
      durationDays,
      dailyRate: calculateDailyRate(elementsRow.price, durationDays)
    });
  }

  finalRows.push(
    ...competitorRows.map((row) => ({
      ...row,
      isElements: Boolean(row.isElements)
    }))
  );

  return finalRows.sort((left, right) => {
    if (left.isElements) {
      return -1;
    }

    if (right.isElements) {
      return 1;
    }

    return Number(left.dailyRate ?? Infinity) - Number(right.dailyRate ?? Infinity);
  });
};


const collectBucketMetrics = (bucket, options = {}) => {
  const {
    selectedVehicle = "",
    selectedPickupLocation = "",
    selectedDropoffLocation = ""
  } = options;
  const normalizedVehicleKey = normalizeVehicleKey(selectedVehicle);
  const normalizedPickupLocation = normalize(selectedPickupLocation);
  const normalizedDropoffLocation = normalize(selectedDropoffLocation || selectedPickupLocation);
  const elementsRows = (bucket?.elementsRows || []).filter((row) => {
    if (normalizedVehicleKey && normalizeVehicleKey(row.vehicle) !== normalizedVehicleKey) {
      return false;
    }

    if (!normalizedPickupLocation && !normalizedDropoffLocation) {
      return true;
    }

    const rowPickup = normalize(row.pickupLocation || row.location);
    const rowDropoff = normalize(row.dropoffLocation || row.location);
    const pickupMatch = !normalizedPickupLocation || rowPickup === normalizedPickupLocation;
    const dropoffMatch = !normalizedDropoffLocation || rowDropoff === normalizedDropoffLocation;
    return pickupMatch && dropoffMatch;
  });
  const competitorRows = (bucket?.competitorCandidates || [])
    .filter(isValidCompetitorPriceRow)
    .map((row) => {
      const durationDays = getRowDurationDays(row);
      const trendDailyRate = resolveTrendDailyRate({ ...row, durationDays });
      return {
        ...row,
        durationDays,
        dailyRate: calculateDailyRate(row.price, durationDays),
        trendDailyRate
      };
    });
  const competitorRowsWithDailyRate = competitorRows.filter(
    (row) =>
      row.trendDailyRate !== null &&
      row.trendDailyRate !== undefined &&
      Number.isFinite(Number(row.trendDailyRate))
  );
  const competitorPrices = competitorRowsWithDailyRate.map((row) => Number(row.trendDailyRate));
  const validElementsRows = elementsRows
    .map((row) => {
      const durationDays = getRowDurationDays(row);
      const trendDailyRate = resolveTrendDailyRate({ ...row, durationDays });
      return {
        ...row,
        durationDays,
        trendDailyRate
      };
    })
    .filter((row) => row.trendDailyRate !== null);
  const latestElementsRow = validElementsRows.length
    ? validElementsRows.reduce((latest, row) =>
        compareScrapeDates(row.scrapeDate, latest.scrapeDate) >= 0 ? row : latest
      )
    : null;
  const competitorTrendRows = competitorRowsWithDailyRate;
  const cheapestRow = competitorRowsWithDailyRate.length
    ? competitorTrendRows.reduce((min, row) =>
        row.trendDailyRate < min.trendDailyRate ? row : min
      )
    : null;
  const highestRow = competitorRowsWithDailyRate.length
    ? competitorTrendRows.reduce((max, row) =>
        row.trendDailyRate > max.trendDailyRate ? row : max
      )
    : null;

  return {
    elementsRows,
    competitorRows,
    competitorPrices,
    elementsPrices: validElementsRows.map((row) => row.trendDailyRate),
    cheapestRow,
    highestRow,
    lowest: cheapestRow ? cheapestRow.trendDailyRate : null,
    highest: highestRow ? highestRow.trendDailyRate : null,
    average: competitorPrices.length ? averageFrom(competitorPrices) : null,
    elements: latestElementsRow ? latestElementsRow.trendDailyRate : null
  };
};

export const calculateRecommendedPrice = (baselinePrice, durationDays, adjustmentPercent) => {
  if (
    baselinePrice === null ||
    baselinePrice === undefined ||
    Number.isNaN(baselinePrice)
  ) {
    return {
      baselinePrice: null,
      recommendedDailyRate: null,
      recommendedTotalPrice: null
    };
  }

  const recommendedDailyRate = baselinePrice * (1 + adjustmentPercent / 100);
  const recommendedTotalPrice =
    durationDays !== null &&
    durationDays !== undefined &&
    Number.isFinite(durationDays) &&
    durationDays > 0
      ? recommendedDailyRate * durationDays
      : null;

  return {
    baselinePrice,
    recommendedDailyRate,
    recommendedTotalPrice
  };
};

const formatCompetitorLabel = (row) =>
  row ? `${row.company} - ${row.vehicle} (${formatCurrency(row.price)})` : "No competitor data";

export const formatDiffVsElements = (diff) => {
  if (diff === null || diff === undefined || Number.isNaN(diff)) {
    return "No data";
  }

  if (diff > 0) {
    return `+${formatCurrency(diff)} (More expensive)`;
  }

  if (diff < 0) {
    return `-${formatCurrency(Math.abs(diff))} (Cheaper)`;
  }

  return `${formatCurrency(0)} (Same price)`;
};

const groupRelevantRows = (rows, config, selectedVehicle) => {
  const grouped = new Map();

  rows.forEach((row) => {
    const normalizedSelectedVehicle = normalizeVehicle(selectedVehicle);
    const normalizedRowVehicle = normalizeVehicle(row.vehicle);
    const selectedVehicleKey = normalizeVehicleKey(selectedVehicle);
    const rowVehicleKey = normalizeVehicleKey(row.vehicle);
    const competitorLookup = normalize(`${row.company} ${normalizedRowVehicle}`);
    const competitorVehicleOnlyLookup = normalize(normalizedRowVehicle);
    const isElementsRow =
      normalize(row.company) === "elementsworld" &&
      (!normalizedSelectedVehicle || rowVehicleKey === selectedVehicleKey);
    const isCompetitorRow =
      normalize(row.company) !== "elementsworld" &&
      config.competitorVehicles.some(
        (competitorToken) =>
          competitorLookup.includes(competitorToken) ||
          competitorVehicleOnlyLookup.includes(competitorToken)
      );

    if (!isElementsRow && !isCompetitorRow) {
      return;
    }

    const key = row.dateKey;
    if (!grouped.has(key)) {
      grouped.set(key, {
        dateKey: key,
        elementsRows: [],
        competitorCandidates: []
      });
    }

    const bucket = grouped.get(key);
    if (!bucket) {
      return;
    }

    if (isElementsRow) {
      bucket.elementsRows.push(row);
      return;
    }

    bucket.competitorCandidates.push(row);
  });

  return grouped;
};

function isSameVehicle(rowVehicle, selectedVehicle) {
  return normalizeVehicleKey(rowVehicle) === normalizeVehicleKey(selectedVehicle);
}

function findNearestElementsPrice(grouped, targetDate, selectedVehicle) {
  const dates = Array.from(grouped.keys()).sort();

  if (!dates.length) return null;

  let nearestDate = null;
  let minDiff = Infinity;

  dates.forEach((dateKey) => {
    const bucket = grouped.get(dateKey);
    if (!bucket || !bucket.elementsRows.length) return;

    const diff = Math.abs(new Date(dateKey) - new Date(targetDate));

    if (diff < minDiff) {
      minDiff = diff;
      nearestDate = dateKey;
    }
  });

  if (!nearestDate) return null;

  const bucket = grouped.get(nearestDate);
  if (!bucket) return null;

  const validRows = selectedVehicle
    ? bucket.elementsRows.filter((row) => isSameVehicle(row.vehicle, selectedVehicle))
    : bucket.elementsRows;

  if (!validRows.length) return null;

  const prices = validRows.map((row) => row.price);

  if (!prices.length) {
    return null;
  }

  return {
    value: prices.reduce((a, b) => a + b, 0) / prices.length,
    date: nearestDate
  };
}

export const filterExactTripRows = ({
  rows,
  selectedPickup = "",
  selectedDropoff = "",
  selectedVehicle = "",
  selectedLocation = ""
}) =>
  rows.filter(
    (row) =>
      (!selectedPickup || row.dateKey === selectedPickup) &&
      (!selectedDropoff || row.dropoffDateKey === selectedDropoff) &&
      (!selectedVehicle ||
        normalizeVehicleKey(row.vehicle) === normalizeVehicleKey(selectedVehicle)) &&
      (!selectedLocation || row.location === selectedLocation) &&
      row.company === "elementsworld"
  );

export const selectExactTripRow = (filters) =>
  filterExactTripRows(filters).reduce((latest, row) => {
    if (!latest) {
      return row;
    }

    return compareScrapeDates(row.scrapeDate, latest.scrapeDate) >= 0 ? row : latest;
  }, null);

export const buildExactTripMetrics = ({
  rows,
  selectedPickup = "",
  selectedDropoff = "",
  selectedVehicle = "",
  selectedLocation = ""
}) => {
  const selectedRow = selectExactTripRow({
    rows,
    selectedPickup,
    selectedDropoff,
    selectedVehicle,
    selectedLocation
  });
  const duration =
    selectedPickup && selectedDropoff
      ? (new Date(selectedDropoff) - new Date(selectedPickup)) / (1000 * 60 * 60 * 24)
      : null;
  const totalPrice = selectedRow ? selectedRow.price : null;
  const dailyRate =
    totalPrice !== null &&
    duration !== null &&
    Number.isFinite(duration) &&
    duration > 0
      ? Math.round(totalPrice / duration)
      : null;

  return {
    selectedRow,
    duration,
    totalPrice,
    dailyRate,
    hasExactMatch: Boolean(selectedRow)
  };
};

export const selectDefaultElementsRow = (rows) => {
  const elementsRows = rows.filter(
    (row) =>
      normalize(row.company) === "elementsworld" &&
      Boolean(vehicleConfigs[normalizeVehicle(row.vehicle)])
  );

  if (!elementsRows.length) {
    return null;
  }

  const companyVehicleCoverageByKey = new Map();
  const vehicleCoverageByKey = new Map();
  rows.forEach((entry) => {
    if (normalize(entry.company) === "elementsworld") {
      return;
    }

    const normalizedVehicle = normalizeVehicle(entry.vehicle);
    const companyVehicleKey = `${entry.dateKey}|${entry.dropoffDateKey}|${normalize(
      `${entry.company} ${normalizedVehicle}`
    )}`;
    const vehicleOnlyKey = `${entry.dateKey}|${entry.dropoffDateKey}|${normalize(
      normalizedVehicle
    )}`;

    companyVehicleCoverageByKey.set(
      companyVehicleKey,
      (companyVehicleCoverageByKey.get(companyVehicleKey) || 0) + 1
    );
    vehicleCoverageByKey.set(
      vehicleOnlyKey,
      (vehicleCoverageByKey.get(vehicleOnlyKey) || 0) + 1
    );
  });

  const scoredRows = elementsRows.map((row) => {
    const normalizedVehicle = normalizeVehicle(row.vehicle);
    const mappedCompetitors = getMappedCompetitors(normalizedVehicle);
    const coverage = mappedCompetitors.reduce((count, competitorVehicle) => {
      const companyVehicleKey = `${row.dateKey}|${row.dropoffDateKey}|${competitorVehicle}`;
      const vehicleOnlyKey = `${row.dateKey}|${row.dropoffDateKey}|${competitorVehicle}`;
      return (
        count +
        (companyVehicleCoverageByKey.get(companyVehicleKey) || 0) +
        (vehicleCoverageByKey.get(vehicleOnlyKey) || 0)
      );
    }, 0);

    return {
      row,
      coverage
    };
  });

  scoredRows.sort((left, right) => {
    if (right.coverage !== left.coverage) {
      return right.coverage - left.coverage;
    }

    const pickupDiff =
      new Date(formatDate(left.row.dateKey)) - new Date(formatDate(right.row.dateKey));

    if (pickupDiff !== 0) {
      return pickupDiff;
    }

    return (
      new Date(formatDate(left.row.dropoffDateKey)) -
      new Date(formatDate(right.row.dropoffDateKey))
    );
  });

  return scoredRows.length ? scoredRows[0].row : null;
};

export const buildDashboardFromRows = ({
  rows,
  config,
  adjustment,
  selectedDate = "",
  selectedVehicle = "",
  selectedPickupLocation = "",
  selectedDropoffLocation = ""
}) => {
  if (!rows.length) {
    return initialDashboard;
  }

  const grouped = groupRelevantRows(rows, config, selectedVehicle);
  grouped.forEach((bucket) => {
    bucket.elementsRows = selectedVehicle
      ? bucket.elementsRows.filter((row) => isSameVehicle(row.vehicle, selectedVehicle))
      : bucket.elementsRows;
  });

  const sortedDates = Array.from(grouped.keys()).sort();
  const trend = sortedDates.map((dateKey) => {
    const bucketMetrics = collectBucketMetrics(grouped.get(dateKey), {
      selectedVehicle,
      selectedPickupLocation,
      selectedDropoffLocation
    });

    return {
      cheapestDurationDays: bucketMetrics.cheapestRow
        ? getRowDurationDays(bucketMetrics.cheapestRow)
        : null,
      dateKey,
      lowest: bucketMetrics.lowest,
      highest: bucketMetrics.highest,
      cheapestRow: bucketMetrics.cheapestRow,
      highestRow: bucketMetrics.highestRow,
      elements: bucketMetrics.elements,
      recommended: (() => {
        const recommendedPricing = calculateRecommendedPrice(
          bucketMetrics.lowest ?? bucketMetrics.elements,
          null,
          adjustment
        );

        return recommendedPricing.recommendedDailyRate === null ||
          recommendedPricing.recommendedDailyRate === undefined ||
          Number.isNaN(recommendedPricing.recommendedDailyRate)
          ? null
          : Math.round(recommendedPricing.recommendedDailyRate);
      })(),
      competitorCount: bucketMetrics.competitorRows.length
    };
  });

  const latestDate = sortedDates.length ? sortedDates[sortedDates.length - 1] : "";
  const selectedMetrics = selectedDate
    ? collectBucketMetrics(grouped.get(selectedDate), {
        selectedVehicle,
        selectedPickupLocation,
        selectedDropoffLocation
      })
    : null;
  const latestMetrics = latestDate
    ? collectBucketMetrics(grouped.get(latestDate), {
        selectedVehicle,
        selectedPickupLocation,
        selectedDropoffLocation
      })
    : null;

  let snapshotMetrics = latestMetrics;
  let latestRows = latestMetrics ? [...latestMetrics.competitorRows] : [];
  let displayDate = latestDate;

  if (selectedDate) {
    snapshotMetrics = selectedMetrics;
    latestRows = selectedMetrics ? [...selectedMetrics.competitorRows] : [];
    displayDate = selectedDate;
  } else if (!latestRows.length) {
    latestRows = sortedDates.flatMap((dateKey) => {
      const bucketMetrics = collectBucketMetrics(grouped.get(dateKey), {
        selectedVehicle,
        selectedPickupLocation,
        selectedDropoffLocation
      });
      return bucketMetrics.competitorRows;
    });
    snapshotMetrics = {
      elementsRows: sortedDates.flatMap((dateKey) => {
        const bucketMetrics = collectBucketMetrics(grouped.get(dateKey), {
          selectedVehicle,
          selectedPickupLocation,
          selectedDropoffLocation
        });
        return bucketMetrics.elementsRows;
      }),
      elementsPrices: sortedDates.flatMap((dateKey) => {
        const bucketMetrics = collectBucketMetrics(grouped.get(dateKey), {
          selectedVehicle,
          selectedPickupLocation,
          selectedDropoffLocation
        });
        return bucketMetrics.elementsPrices;
      })
    };
    displayDate = latestDate || "";
  }

  latestRows = latestRows.map((row) => ({
    ...row,
    durationDays: getRowDurationDays(row),
    dailyRate: calculateDailyRate(row.price, getRowDurationDays(row))
  }));

  latestRows.sort((left, right) => {
    if (left.dateKey !== right.dateKey) {
      return left.dateKey.localeCompare(right.dateKey);
    }

    return (left.dailyRate ?? Infinity) - (right.dailyRate ?? Infinity);
  });

  const competitorPrices = latestRows
    .map((row) => calculateDailyRate(row.price, getRowDurationDays(row)))
    .filter((rate) => rate !== null);
  const hasCompetitors = competitorPrices.length > 0;
  const latestAverage = hasCompetitors ? averageFrom(competitorPrices) : null;
  let latestElements = snapshotMetrics?.elementsRows
    ?.filter((row) => (selectedVehicle ? isSameVehicle(row.vehicle, selectedVehicle) : true))
    .map((row) => calculateDailyRate(row.price, getRowDurationDays(row)));
  latestElements = latestElements?.length
    ? averageFrom(latestElements.filter((rate) => rate !== null))
    : null;
  let fallbackDate = null;

  if (!latestElements && selectedDate) {
    const fallback = findNearestElementsPrice(grouped, selectedDate, selectedVehicle);

    if (fallback) {
      latestElements = fallback.value;
      fallbackDate = fallback.date;
    }
  }
  const latestRowsWithDailyRate = latestRows.filter((row) => row.dailyRate !== null);
  const cheapestRow = latestRowsWithDailyRate.length
    ? latestRowsWithDailyRate.reduce((min, row) => (row.dailyRate < min.dailyRate ? row : min))
    : null;
  const highestRow = latestRowsWithDailyRate.length
    ? latestRowsWithDailyRate.reduce((max, row) => (row.dailyRate > max.dailyRate ? row : max))
    : null;
  const lowest = cheapestRow ? cheapestRow.dailyRate : null;
  const highest = highestRow ? highestRow.dailyRate : null;
  const elementsPrice = latestElements;
  const recommendationBaseline = getBaselinePrice(lowest, elementsPrice);
  const recommendedPricing = calculateRecommendedPrice(
    recommendationBaseline.baselinePrice,
    cheapestRow
      ? cheapestRow.durationDays
      : snapshotMetrics?.elementsRows?.[0]
      ? getRowDurationDays(snapshotMetrics.elementsRows[0])
      : null,
    adjustment
  );
  const recommended =
    recommendedPricing.recommendedTotalPrice === null ||
    recommendedPricing.recommendedTotalPrice === undefined ||
    Number.isNaN(recommendedPricing.recommendedTotalPrice)
      ? null
      : Math.round(recommendedPricing.recommendedTotalPrice);
  const spread =
    lowest !== null && highest !== null && !Number.isNaN(lowest) && !Number.isNaN(highest)
      ? highest - lowest
      : null;
  const upliftValue =
    recommended === null || recommended === undefined || Number.isNaN(recommended)
      ? null
      : elementsPrice !== null && elementsPrice !== undefined && !Number.isNaN(elementsPrice)
      ? recommended - elementsPrice
      : lowest !== null && lowest !== undefined && !Number.isNaN(lowest)
      ? recommended - lowest
      : null;
  const observedQuotes = trend.reduce(
    (sum, item) => sum + item.competitorCount,
    0
  );

  const companyMap = latestRows.reduce((accumulator, row) => {
    const current = accumulator.get(row.company) || {
      company: row.company,
      prices: [],
      vehicles: new Set()
    };

    current.prices.push(row.price);
    current.vehicles.add(row.vehicle);
    accumulator.set(row.company, current);
    return accumulator;
  }, new Map());

  const companyStats = Array.from(companyMap.values())
    .map((entry) => ({
      company: entry.company,
      average: averageFrom(entry.prices),
      vehicles: Array.from(entry.vehicles).join(", "),
      count: entry.prices.length
    }))
    .sort((left, right) => left.average - right.average);
  return {
    summary: {
      lowest,
      average: latestAverage,
      highest,
      cheapestRow,
      highestRow,
      elements: latestElements,
      recommended,
      spread,
      upliftValue,
      upliftPercent: adjustment,
      recommendedDailyRate: recommendedPricing.recommendedDailyRate,
      recommendationSource: recommendationBaseline.source,
      competitorCount: latestRows.length,
      fallbackDate,
      trackedDates: trend.length,
      observedQuotes
    },
    trend,
    latestRows,
    companyStats,
    latestDate,
    latestDateLabel: displayDate
      ? formatDateLabel(displayDate, { year: "numeric" })
        : "No snapshot yet"
  };
};

const formatCount = (value) =>
  new Intl.NumberFormat("en-NZ", {
    maximumFractionDigits: 0
  }).format(value);

const formatDateLabel = (value, options = {}) => {
  if (!value) {
    return "No date";
  }

  const hasCustomOptions = Object.keys(options).length > 0;
  if (!hasCustomOptions || (Object.keys(options).length === 1 && options.year === "numeric")) {
    const normalizedDate = toDateKey(value);
    return normalizedDate ? formatDateDMY(normalizedDate) : value;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-NZ", {
    day: "numeric",
    month: "short",
    ...options
  }).format(date);
};

const formatDateTimeLabel = (value) => {
  if (!value) {
    return "Not available";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-NZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
};

const averageFrom = (numbers) =>
  numbers.length
    ? numbers.reduce((sum, number) => sum + number, 0) / numbers.length
    : 0;

const calculateTripDays = (pickupDate, dropoffDate) => {
  if (!pickupDate || !dropoffDate) {
    return null;
  }

  const duration = Math.round((dropoffDate.getTime() - pickupDate.getTime()) / 86400000);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
};

function StatCard({ label, value, detail, tone = "default" }) {
  return (
    <article className={`stat-card stat-card--${tone}`}>
      <p className="stat-card__label">{label}</p>
      <strong className="stat-card__value">{value}</strong>
      <p className="stat-card__detail">{detail}</p>
    </article>
  );
}

function FilterChip({ active, children, onClick }) {
  return (
    <button
      type="button"
      className={`filter-chip ${active ? "filter-chip--active" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function PriceTrendChart({ data, selectedPickupDate = "", onActiveDateChange = null }) {
  const [hoveredDateKey, setHoveredDateKey] = useState("");
  useEffect(() => {
    if (typeof onActiveDateChange === "function") {
      onActiveDateChange(hoveredDateKey || "");
    }
  }, [hoveredDateKey, onActiveDateChange]);

  return (
    <ParentSize debounceTime={10}>
      {({ width }) => {
        const safeWidth = Math.max(width, 320);
        const height = 360;
        const margin = { top: 24, right: 24, bottom: 58, left: 64 };
        const innerWidth = safeWidth - margin.left - margin.right;
        const innerHeight = height - margin.top - margin.bottom;

        if (!data.length || innerWidth <= 0 || innerHeight <= 0) {
          return <div className="chart-empty">Trend data appears as prices load.</div>;
        }

        const elementsData = data.filter((item) => item.elements !== null);
        const lowestData = data.filter((item) => item.lowest !== null);
        const highestData = data.filter((item) => item.highest !== null);
        const recommendedData = data.filter((item) => item.recommended !== null);
        const values = data.flatMap((item) =>
          [item.elements, item.lowest, item.highest, item.recommended].filter(
            (entry) => entry !== null && entry !== undefined
          )
        );

        const yMax = Math.max(...values, 0);
        const isSingleDate = data.length === 1;
        const xScale = scalePoint({
          domain: data.map((item) => item.dateKey),
          range: [0, innerWidth],
          padding: 0.5
        });
        const yScale = scaleLinear({
          domain: [0, yMax * 1.15 || 100],
          range: [innerHeight, 0],
          nice: true
        });

        const tickStep = Math.max(1, Math.ceil(data.length / 6));
        const tickValues = data
          .filter((_, index) => index % tickStep === 0 || index === data.length - 1)
          .map((item) => item.dateKey);
        const selectedX = selectedPickupDate ? xScale(selectedPickupDate) : undefined;
        const activeTooltipItem = hoveredDateKey
          ? data.find((item) => item.dateKey === hoveredDateKey) || null
          : null;
        const activeTooltipX = activeTooltipItem
          ? xScale(activeTooltipItem.dateKey) ?? 0
          : 0;
        const tooltipLines = activeTooltipItem
          ? [
              `Date: ${formatDateLabel(activeTooltipItem.dateKey, { year: "numeric" })}`,
              `Elements: ${formatCurrency(activeTooltipItem.elements)}`,
              `Cheapest: ${formatCurrency(activeTooltipItem.lowest)}`,
              `Highest: ${formatCurrency(activeTooltipItem.highest)}`,
              `Recommended: ${formatCurrency(activeTooltipItem.recommended)}`
            ]
          : [];
        const tooltipWidth = 222;
        const tooltipHeight = 112;
        const tooltipX = Math.max(
          0,
          Math.min(innerWidth - tooltipWidth, activeTooltipX + 14)
        );
        const tooltipY = 8;
        const latestPoint = data[data.length - 1];
        const latestX = latestPoint ? xScale(latestPoint.dateKey) ?? 0 : 0;
        const latestLabelAnchor =
          latestX < innerWidth - 130 ? "start" : "end";
        const latestLabelX = latestLabelAnchor === "start" ? latestX + 10 : latestX - 10;
        const latestLabels = latestPoint
          ? [
              {
                key: "elements",
                value: latestPoint.elements,
                color: "#2d6a4f",
                y: latestPoint.elements !== null ? yScale(latestPoint.elements) - 12 : null
              },
              {
                key: "lowest",
                value: latestPoint.lowest,
                color: "#c96c34",
                y: latestPoint.lowest !== null ? yScale(latestPoint.lowest) + 16 : null
              },
              {
                key: "highest",
                value: latestPoint.highest,
                color: "#d8a15d",
                y: latestPoint.highest !== null ? yScale(latestPoint.highest) - 22 : null
              },
              {
                key: "recommended",
                value: latestPoint.recommended,
                color: "#1b4332",
                y:
                  latestPoint.recommended !== null
                    ? yScale(latestPoint.recommended) + 28
                    : null
              }
            ].filter((entry) => entry.value !== null && entry.y !== null)
          : [];
        const points = data.flatMap((item) => [
          { key: "elements", label: "Elements", value: item.elements, dateKey: item.dateKey },
          { key: "lowest", label: "Cheapest", value: item.lowest, dateKey: item.dateKey },
          { key: "highest", label: "Highest", value: item.highest, dateKey: item.dateKey },
          { key: "recommended", label: "Recommended", value: item.recommended, dateKey: item.dateKey }
        ]);
        const validPoints = points.filter(
          (point) => point.value !== null && point.value !== undefined && !Number.isNaN(point.value)
        );
        const maxPoint =
          validPoints.length > 0
            ? validPoints.reduce((max, point) => (point.value > max.value ? point : max))
            : null;
        const minPoint =
          validPoints.length > 0
            ? validPoints.reduce((min, point) => (point.value < min.value ? point : min))
            : null;
        const extremeLabels = [maxPoint, minPoint]
          .filter(Boolean)
          .map((point, index) => {
            const x = xScale(point.dateKey) ?? 0;
            const y = yScale(point.value);
            return {
              id: `${point.key}-${point.dateKey}-${index}`,
              text: `${point.label}: ${formatCurrency(point.value)}`,
              x: Math.max(8, Math.min(innerWidth - 8, x)),
              y:
                index % 2 === 0
                  ? Math.max(14, y - 14)
                  : Math.min(innerHeight - 8, y + 16),
              anchor: x < innerWidth - 120 ? "start" : "end"
            };
          });

        return (
          <svg width={safeWidth} height={height} role="img" aria-label="Pricing trend chart">
            <LinearGradient
              id="trend-surface"
              from="#f4efdf"
              to="#eef5f0"
              x1="0%"
              x2="100%"
              y1="0%"
              y2="100%"
            />
            <rect width={safeWidth} height={height} rx={24} fill="url(#trend-surface)" />
            <Group left={margin.left} top={margin.top}>
              {selectedX !== undefined ? (
                <line
                  x1={selectedX}
                  x2={selectedX}
                  y1={0}
                  y2={innerHeight}
                  stroke="#1b4332"
                  strokeWidth={2}
                  strokeDasharray="6 6"
                  opacity={0.5}
                />
              ) : null}

              {yScale.ticks(4).map((tick) => (
                <line
                  key={tick}
                  x1={0}
                  x2={innerWidth}
                  y1={yScale(tick)}
                  y2={yScale(tick)}
                  stroke="rgba(53, 78, 64, 0.12)"
                  strokeDasharray="4 8"
                />
              ))}

              <AxisLeft
                scale={yScale}
                numTicks={4}
                stroke="rgba(27, 48, 38, 0.45)"
                tickStroke="transparent"
                tickFormat={(value) => `$${value}`}
                tickLabelProps={() => ({
                  fill: "#516255",
                  fontSize: 11,
                  textAnchor: "end",
                  dx: "-0.35em",
                  dy: "0.25em"
                })}
              />
              <AxisBottom
                top={innerHeight}
                scale={xScale}
                tickValues={tickValues}
                stroke="rgba(27, 48, 38, 0.45)"
                tickStroke="transparent"
                tickFormat={(value) => formatDateLabel(value)}
                tickLabelProps={() => ({
                  fill: "#516255",
                  fontSize: 11,
                  textAnchor: "middle",
                  dy: "0.75em"
                })}
              />

              {isSingleDate ? (
                (() => {
                  const item = data[0];
                  const centerX = xScale(item.dateKey) ?? innerWidth / 2;
                  const series = [
                    { key: "elements", value: item.elements, fill: "#2d6a4f" },
                    { key: "lowest", value: item.lowest, fill: "#c96c34" },
                    { key: "highest", value: item.highest, fill: "#d8a15d" },
                    {
                      key: "recommended",
                      value: item.recommended,
                      fill: "#1b4332",
                      dash: "6 4"
                    }
                  ].filter((entry) => entry.value !== null && entry.value !== undefined);
                  const barWidth = Math.min(48, Math.max(22, innerWidth / 10));
                  const gap = Math.min(16, Math.max(8, barWidth * 0.35));
                  const totalWidth =
                    series.length * barWidth + Math.max(0, series.length - 1) * gap;
                  const startX = centerX - totalWidth / 2;

                  return (
                    <>
                      {series.map((entry, index) => {
                        const value = entry.value ?? 0;
                        const x = startX + index * (barWidth + gap);
                        const y = yScale(value);
                        const barHeight = innerHeight - y;
                        const tooltip = (() => {
                          if (entry.key === "lowest") {
                            return `Cheapest: ${formatCompetitorLabel(item.cheapestRow)}`;
                          }

                          if (entry.key === "highest") {
                            return `Highest: ${formatCompetitorLabel(item.highestRow)}`;
                          }

                          if (entry.key === "elements") {
                            return `Elements: ${formatCurrency(item.elements)}`;
                          }

                          return `Recommended: ${formatCurrency(item.recommended)}`;
                        })();

                        return (
                          <g key={entry.key}>
                            <title>{tooltip}</title>
                            <Bar
                              x={x}
                              y={y}
                              width={barWidth}
                              height={barHeight}
                              rx={12}
                              fill={entry.fill}
                              stroke={entry.fill}
                              strokeWidth={entry.dash ? 2 : 0}
                              fillOpacity={entry.dash ? 0.14 : 0.92}
                              strokeDasharray={entry.dash}
                            />
                          </g>
                        );
                      })}
                      <rect
                        x={0}
                        y={0}
                        width={innerWidth}
                        height={innerHeight}
                        fill="transparent"
                        onMouseEnter={() => setHoveredDateKey(item.dateKey)}
                        onMouseMove={() => setHoveredDateKey(item.dateKey)}
                        onMouseLeave={() => setHoveredDateKey("")}
                      />
                    </>
                  );
                })()
              ) : (
                <>
                  <LinePath
                    data={lowestData}
                    curve={curveMonotoneX}
                    x={(item) => xScale(item.dateKey) ?? 0}
                    y={(item) => yScale(item.lowest)}
                    stroke="#c96c34"
                    strokeWidth={3}
                  />
                  <LinePath
                    data={highestData}
                    curve={curveMonotoneX}
                    x={(item) => xScale(item.dateKey) ?? 0}
                    y={(item) => yScale(item.highest)}
                    stroke="#d8a15d"
                    strokeWidth={3}
                  />
                  <LinePath
                    data={recommendedData}
                    curve={curveMonotoneX}
                    x={(item) => xScale(item.dateKey) ?? 0}
                    y={(item) => yScale(item.recommended)}
                    stroke="#1b4332"
                    strokeWidth={2}
                    strokeDasharray="8 8"
                  />
                  <LinePath
                    data={elementsData}
                    curve={curveMonotoneX}
                    x={(item) => xScale(item.dateKey) ?? 0}
                    y={(item) => yScale(item.elements)}
                    stroke="#2d6a4f"
                    strokeWidth={3.5}
                  />

                  {data.map((item) => {
                    const x = xScale(item.dateKey) ?? 0;
                    return (
                      <g key={item.dateKey}>
                        <rect
                          x={x - 18}
                          y={0}
                          width={36}
                          height={innerHeight}
                          fill="transparent"
                          onMouseEnter={() => setHoveredDateKey(item.dateKey)}
                          onMouseMove={() => setHoveredDateKey(item.dateKey)}
                          onMouseLeave={() => setHoveredDateKey("")}
                        />
                        {item.lowest !== null ? (
                          <circle cx={x} cy={yScale(item.lowest)} r={4} fill="#c96c34" />
                        ) : null}
                        {item.highest !== null ? (
                          <circle cx={x} cy={yScale(item.highest)} r={4} fill="#d8a15d" />
                        ) : null}
                        {item.elements !== null ? (
                          <circle cx={x} cy={yScale(item.elements)} r={5} fill="#2d6a4f" />
                        ) : null}
                      </g>
                    );
                  })}

                </>
              )}

              {latestLabels.map((entry) => (
                <Text
                  key={entry.key}
                  x={latestLabelX}
                  y={Math.max(14, Math.min(innerHeight - 8, entry.y))}
                  textAnchor={latestLabelAnchor}
                  fill={entry.color}
                  fontSize={11}
                >
                  {formatCurrency(entry.value)}
                </Text>
              ))}

              {extremeLabels.map((entry) => (
                <Text
                  key={entry.id}
                  x={entry.x}
                  y={entry.y}
                  textAnchor={entry.anchor}
                  fill="#435045"
                  fontSize={10}
                >
                  {entry.text}
                </Text>
              ))}

              {activeTooltipItem ? (
                <Group left={tooltipX} top={tooltipY}>
                  <rect
                    width={tooltipWidth}
                    height={tooltipHeight}
                    rx={12}
                    fill="rgba(27, 48, 38, 0.92)"
                    stroke="rgba(255, 255, 255, 0.25)"
                  />
                  {tooltipLines.map((line, index) => (
                    <Text
                      key={line}
                      x={12}
                      y={20 + index * 18}
                      fill="#f5f7f6"
                      fontSize={11}
                    >
                      {line}
                    </Text>
                  ))}
                </Group>
              ) : null}
            </Group>
          </svg>
        );
      }}
    </ParentSize>
  );
}

function MarketSpreadChart({
  lowest,
  highest,
  recommended,
  elements,
  cheapestRow,
  highestRow
}) {
  return (
    <ParentSize debounceTime={10}>
      {({ width }) => {
        const safeWidth = Math.max(width, 320);
        const height = 388;
        const margin = { top: 24, right: 24, bottom: 112, left: 58 };
        const innerWidth = safeWidth - margin.left - margin.right;
        const innerHeight = height - margin.top - margin.bottom;

        if (
          innerWidth <= 0 ||
          innerHeight <= 0 ||
          [lowest, highest, recommended, elements].every(
            (value) => value === null || value === undefined || Number.isNaN(value)
          )
        ) {
          return <div className="chart-empty">Competitor spread will appear for the latest market date.</div>;
        }

        const groupData = [
          {
            label: "Cheapest",
            value: lowest,
            fill: "#c96c34",
            tooltip: `Cheapest: ${formatCompetitorLabel(cheapestRow)}`
          },
          {
            label: "Highest",
            value: highest,
            fill: "#d8a15d",
            tooltip: `Highest: ${formatCompetitorLabel(highestRow)}`
          },
          {
            label: "Elements",
            value: elements,
            fill: "#6c8a72",
            tooltip: `Elements: ${formatCurrency(elements)}`
          },
          {
            label: "Recommended",
            value: recommended,
            fill: "#1b4332",
            tooltip: `Recommended: ${formatCurrency(recommended)}`
          }
        ].filter((item) => item.value !== null && item.value !== undefined);
        const xScale = scaleBand({
          domain: groupData.map((item) => item.label),
          range: [0, innerWidth],
          padding: 0.32
        });
        const yScale = scaleLinear({
          domain: [
            0,
            Math.max(
              ...groupData.map((item) => item.value),
              0
            ) * 1.18
          ],
          range: [innerHeight, 0],
          nice: true
        });

        return (
          <svg width={safeWidth} height={height} role="img" aria-label="Market spread bar chart">
            <LinearGradient
              id="spread-surface"
              from="#f8f3ea"
              to="#f2f7f3"
              x1="0%"
              x2="100%"
              y1="0%"
              y2="100%"
            />
            <rect width={safeWidth} height={height} rx={24} fill="url(#spread-surface)" />
            <Group left={margin.left} top={margin.top}>
              {yScale.ticks(4).map((tick) => (
                <line
                  key={tick}
                  x1={0}
                  x2={innerWidth}
                  y1={yScale(tick)}
                  y2={yScale(tick)}
                  stroke="rgba(53, 78, 64, 0.12)"
                  strokeDasharray="4 8"
                />
              ))}

              {recommended ? (
                <line
                  x1={0}
                  x2={innerWidth}
                  y1={yScale(recommended)}
                  y2={yScale(recommended)}
                  stroke="#1b4332"
                  strokeWidth={2}
                  strokeDasharray="10 8"
                />
              ) : null}

              {elements ? (
                <line
                  x1={0}
                  x2={innerWidth}
                  y1={yScale(elements)}
                  y2={yScale(elements)}
                  stroke="#2d6a4f"
                  strokeWidth={2}
                  strokeDasharray="2 6"
                />
              ) : null}

              <AxisLeft
                scale={yScale}
                numTicks={4}
                stroke="rgba(27, 48, 38, 0.45)"
                tickStroke="transparent"
                tickFormat={(value) => `$${value}`}
                tickLabelProps={() => ({
                  fill: "#516255",
                  fontSize: 11,
                  textAnchor: "end",
                  dx: "-0.35em",
                  dy: "0.25em"
                })}
              />

              <AxisBottom
                top={innerHeight}
                scale={xScale}
                stroke="rgba(27, 48, 38, 0.45)"
                tickStroke="transparent"
                tickLabelProps={() => ({
                  fill: "#516255",
                  fontSize: 11,
                  textAnchor: "middle",
                  dy: "0.75em"
                })}
              />

              {groupData.map((item) => {
                const barX = xScale(item.label) ?? 0;
                const barY = yScale(item.value);
                const barHeight = innerHeight - barY;

                return (
                  <Group key={item.label}>
                    <title>{item.tooltip}</title>
                    <Bar
                      x={barX}
                      y={barY}
                      width={xScale.bandwidth()}
                      height={barHeight}
                      rx={10}
                      fill={item.fill}
                      fillOpacity={0.9}
                    />
                    <Text
                      x={barX + xScale.bandwidth() / 2}
                      y={Math.max(16, barY - 10)}
                      width={xScale.bandwidth() + 12}
                      textAnchor="middle"
                      verticalAnchor="middle"
                      fill="#516255"
                      fontSize={10}
                    >
                      {formatCurrency(item.value)}
                    </Text>
                  </Group>
                );
              })}

              {groupData.map((item, index) => (
                <Group key={item.label} left={index * 118} top={-6}>
                  <rect width={12} height={12} rx={4} fill={item.fill} />
                  <text x={18} y={10} fill="#516255" fontSize={11}>
                    {item.label}
                  </text>
                </Group>
              ))}
            </Group>
          </svg>
        );
      }}
    </ParentSize>
  );
}

function App() {
  const [rows, setRows] = useState([]);
  const [trendData, setTrendData] = useState([]);
  const [trendActiveDateKey, setTrendActiveDateKey] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [isUiTransitioning, setIsUiTransitioning] = useState(false);
  const [vehicle, setVehicle] = useState("");
  const [adjustment, setAdjustment] = useState(5);
  const [location, setLocation] = useState("");
  const [pendingPickupLocation, setPendingPickupLocation] = useState("auckland");
  const [pendingDropoffLocation, setPendingDropoffLocation] = useState("");
  const [appliedPickupLocation, setAppliedPickupLocation] = useState("auckland");
  const [appliedDropoffLocation, setAppliedDropoffLocation] = useState("");
  const [selectedPickupDate, setSelectedPickupDate] = useState("");
  const [selectedDropoffDate, setSelectedDropoffDate] = useState("");
  const [pickupDateInputValue, setPickupDateInputValue] = useState("");
  const [dropoffDateInputValue, setDropoffDateInputValue] = useState("");
  const [isDropoffUserSelected, setIsDropoffUserSelected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [trendDashboard, setTrendDashboard] = useState(initialDashboard);
  const [scrapePickupDate, setScrapePickupDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [scrapeMaxTripDays, setScrapeMaxTripDays] = useState(30);
  const [scrapeSelectedRoutes, setScrapeSelectedRoutes] = useState(["auckland->auckland"]);
  const [scrapeHeadless, setScrapeHeadless] = useState(true);
  const [scrapeSubmitting, setScrapeSubmitting] = useState(false);
  const [scraperStatus, setScraperStatus] = useState(initialScraperStatus);
  const [dataReloadTrigger, setDataReloadTrigger] = useState(0);
  const [scrapeRunFeedback, setScrapeRunFeedback] = useState("");
  const pickupDateInputRef = useRef(null);
  const dropoffDateInputRef = useRef(null);
  const scrapePickupDateInputRef = useRef(null);

  const selectedLocationForLegacyFilters = appliedPickupLocation || location;
  const routeLabel =
    appliedPickupLocation && appliedDropoffLocation
      ? `${appliedPickupLocation} -> ${appliedDropoffLocation}`
      : location || "All depots";
  const lastAutoRefreshedRunIdRef = useRef(null);
  const pickupDate = selectedPickupDate;
  const dropoffDate = selectedDropoffDate;
  const scrapeLocations = useMemo(() => {
    const selected = scrapeRouteOptions.filter((option) =>
      scrapeSelectedRoutes.includes(option.value)
    );
    return Array.from(new Set(selected.flatMap((option) => option.locations)));
  }, [scrapeSelectedRoutes]);
  const scrapeRoutePairs = useMemo(() => {
    return scrapeSelectedRoutes
      .map((routeValue) => {
        const [pickupLocation, dropoffLocation] = String(routeValue).split("->");
        if (!pickupLocation || !dropoffLocation) {
          return null;
        }
        return { pickupLocation, dropoffLocation };
      })
      .filter(Boolean);
  }, [scrapeSelectedRoutes]);
  const handlePickupDateChange = (event) => {
    const normalized = normalizeInputDate(event.target.value);
    setSelectedPickupDate(normalized);
    setPickupDateInputValue(formatDisplayDate(normalized));
    setIsDropoffUserSelected(false);
  };
  const handleDropoffDateChange = (event) => {
    const normalized = normalizeInputDate(event.target.value);
    setSelectedDropoffDate(normalized);
    setDropoffDateInputValue(formatDisplayDate(normalized));
    setIsDropoffUserSelected(true);
  };
  const handlePickupDateInputChange = (event) => {
    const rawValue = event.target.value;
    setPickupDateInputValue(rawValue);
    const normalized = normalizeInputDate(rawValue);
    if (!rawValue.trim()) {
      setSelectedPickupDate("");
      setIsDropoffUserSelected(false);
      return;
    }
    if (normalized) {
      setSelectedPickupDate(normalized);
      setPickupDateInputValue(formatDisplayDate(normalized));
      setIsDropoffUserSelected(false);
    }
  };
  const handleDropoffDateInputChange = (event) => {
    const rawValue = event.target.value;
    setDropoffDateInputValue(rawValue);
    const normalized = normalizeInputDate(rawValue);
    if (!rawValue.trim()) {
      setSelectedDropoffDate("");
      setIsDropoffUserSelected(true);
      return;
    }
    if (normalized) {
      setSelectedDropoffDate(normalized);
      setDropoffDateInputValue(formatDisplayDate(normalized));
      setIsDropoffUserSelected(true);
    }
  };
  const handlePickupLocationChange = (event) => {
    const nextPickupLocation = event.target.value;
    setPendingPickupLocation(nextPickupLocation);
    if (!pendingDropoffLocation) {
      setAppliedPickupLocation(nextPickupLocation);
      setAppliedDropoffLocation("");
    }
  };
  const handleDropoffLocationChange = (event) => {
    const nextDropoffLocation = event.target.value;
    setPendingDropoffLocation(nextDropoffLocation);
    setAppliedPickupLocation(pendingPickupLocation);
    setAppliedDropoffLocation(nextDropoffLocation);
  };
  const openNativeDatePicker = (inputRef) => {
    const input = inputRef.current;
    if (!input) {
      return;
    }

    try {
      input.focus({ preventScroll: true });
      if (typeof input.showPicker === "function") {
        input.showPicker();
        return;
      }
    } catch {
      // no-op: fall back to click below
    }

    try {
      input.click();
    } catch {
      // no-op
    }
  };

  useEffect(() => {
    setPickupDateInputValue(formatDisplayDate(selectedPickupDate));
  }, [selectedPickupDate]);

  useEffect(() => {
    setDropoffDateInputValue(formatDisplayDate(selectedDropoffDate));
  }, [selectedDropoffDate]);

  useEffect(() => {
    if (appliedPickupLocation) {
      setLocation(appliedPickupLocation);
      return;
    }

    setLocation("");
  }, [appliedPickupLocation]);

  useEffect(() => {
    let cancelled = false;
    let activeController = null;

    setLoading(true);
    setLoadError("");
    const loadData = async () => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 30000);
      activeController = controller;

      try {
        const queryParams = new URLSearchParams();
        if (appliedPickupLocation) {
          queryParams.set("pickup_location", appliedPickupLocation);
        }
        if (appliedDropoffLocation) {
          queryParams.set("dropoff_location", appliedDropoffLocation);
        } else if (appliedPickupLocation) {
          // "Same as Pick Up" is the default dropoff behavior.
          queryParams.set("dropoff_location", appliedPickupLocation);
        }
        const query = queryParams.toString() ? `?${queryParams.toString()}` : "";
        const pricesUrl = `${PRICING_API_BASE}/api/prices/latest${query}`;
        const trendsUrl = `${PRICING_API_BASE}/api/prices${query}`;

        const [pricesResponse, trendsResponse] = await Promise.all([
          fetch(pricesUrl, { signal: controller.signal }),
          fetch(trendsUrl, { signal: controller.signal })
        ]);

        if (!pricesResponse.ok) {
          throw new Error(`Failed to fetch data from API (status: ${pricesResponse.status})`);
        }
        if (!trendsResponse.ok) {
          throw new Error(`Failed to fetch data from API (status: ${trendsResponse.status})`);
        }

        const [pricesApiRows, trendsApiRows] = await Promise.all([
          pricesResponse.json(),
          trendsResponse.json()
        ]);
        console.log("API DATA:", Array.isArray(pricesApiRows) ? pricesApiRows.length : 0);

        if (cancelled) {
          return;
        }

        const toDashboardRows = (sourceRows) =>
          (Array.isArray(sourceRows) ? sourceRows : [])
            .map((row) => {
              const dateKey = toDateKey(row.pickup_date);
              const dropoffDateKey = toDateKey(row.dropoff_date);
              const dateObject = parseDate(dateKey);
              const dropoffObject = parseDate(dropoffDateKey);
              const price = Number(row.price);

              if (!dateKey || !dropoffDateKey || !Number.isFinite(price)) {
                return null;
              }

              return {
                id: Number.isFinite(Number(row.id)) ? Number(row.id) : null,
                rawPickupDate: row.pickup_date ? String(row.pickup_date).trim() : "",
                rawDropoffDate: row.dropoff_date ? String(row.dropoff_date).trim() : "",
                dateKey,
                dropoffDate: row.dropoff_date ? String(row.dropoff_date).trim() : "",
                dropoffDateKey,
                company: normalize(row.company),
                vehicle: normalizeVehicle(row.vehicle),
                location: normalize(row.location),
                pickupLocation: normalize(row.pickup_location || row.location),
                dropoffLocation: normalize(row.dropoff_location || row.location),
                hasExplicitPickupLocation:
                  row.pickup_location !== null &&
                  row.pickup_location !== undefined &&
                  String(row.pickup_location).trim() !== "",
                hasExplicitDropoffLocation:
                  row.dropoff_location !== null &&
                  row.dropoff_location !== undefined &&
                  String(row.dropoff_location).trim() !== "",
                type: normalize(row.type),
                price,
                tripDays: calculateTripDays(dateObject, dropoffObject),
                scrapeDate: parseDate(row.scrape_date)
              };
            })
            .filter(Boolean);

        const cleanedRows = toDashboardRows(pricesApiRows);
        const cleanedTrendRows = toDashboardRows(trendsApiRows);

        setRows(cleanedRows);
        setTrendData(cleanedTrendRows);
        console.log("Prices count:", cleanedRows.length);
        console.log("Trends count:", cleanedTrendRows.length);
      } catch (err) {
        if (!cancelled) {
          console.error("API error:", err);
          setLoadError(err instanceof Error ? err.message : "Failed to fetch data from API");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
        window.clearTimeout(timeoutId);
        if (activeController === controller) {
          activeController = null;
        }
      }
    };

    loadData();
    const timer = window.setInterval(loadData, 15000);

    return () => {
      cancelled = true;
      if (activeController) {
        activeController.abort();
      }
      window.clearInterval(timer);
    };
  }, [dataReloadTrigger, appliedPickupLocation, appliedDropoffLocation]);

  useEffect(() => {
    if (!loading) {
      return;
    }

    const watchdogId = window.setTimeout(() => {
      setLoadError((current) => current || "Dashboard load timed out");
      setLoading(false);
    }, 20000);

    return () => {
      window.clearTimeout(watchdogId);
    };
  }, [loading]);

  useEffect(() => {
    let cancelled = false;

    const loadScraperStatus = async () => {
      try {
        const response = await fetch(`${SCRAPER_API_BASE}/api/health`);
        if (!response.ok) {
          throw new Error("Unable to reach scraper service");
        }

        const payload = await response.json();
        if (!cancelled) {
          setScraperStatus({
            ...payload,
            error: ""
          });
        }
      } catch (error) {
        if (!cancelled) {
          setScraperStatus((current) => ({
            ...current,
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "Unable to reach scraper service"
          }));
        }
      }
    };

    loadScraperStatus();
    const timer = window.setInterval(loadScraperStatus, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const latest = scraperStatus.latestRun;
    if (!latest?.id || latest.status !== "completed") {
      return;
    }

    if (lastAutoRefreshedRunIdRef.current === latest.id) {
      return;
    }

    lastAutoRefreshedRunIdRef.current = latest.id;
    setDataReloadTrigger((current) => current + 1);
  }, [scraperStatus.latestRun]);

  useEffect(() => {
    if (!rows.length) {
      setDashboard(initialDashboard);
      return;
    }

    const config = vehicleConfigs[vehicle];
    if (!config) {
      setDashboard(initialDashboard);
      return;
    }
    const relevantRows = [];

    rows.forEach((row) => {
      if (selectedLocationForLegacyFilters && row.location !== selectedLocationForLegacyFilters) {
        return;
      }

      relevantRows.push(row);
    });
    console.log("FILTERED DATA:", relevantRows.length);
    console.log("Filters:", vehicle, selectedLocationForLegacyFilters, [selectedPickupDate, selectedDropoffDate]);

    setDashboard(
      buildDashboardFromRows({
        rows: relevantRows,
        config,
        adjustment,
        selectedDate: selectedPickupDate,
        selectedVehicle: vehicle
      })
    );
  }, [adjustment, selectedLocationForLegacyFilters, rows, selectedPickupDate, selectedDropoffDate, vehicle]);

  useEffect(() => {
    if (!trendData.length) {
      setTrendDashboard(initialDashboard);
      return;
    }

    const config = vehicleConfigs[vehicle];
    if (!config) {
      setTrendDashboard(initialDashboard);
      return;
    }

    const relevantTrendRows = [];

    trendData.forEach((row) => {
      if (selectedLocationForLegacyFilters && row.location !== selectedLocationForLegacyFilters) {
        const isElementsRow = normalize(row.company) === "elementsworld";
        const matchesElementsLocation =
          normalize(row.pickupLocation || row.location) === selectedLocationForLegacyFilters ||
          normalize(row.dropoffLocation || row.location) === selectedLocationForLegacyFilters;
        if (isElementsRow && matchesElementsLocation) {
          relevantTrendRows.push(row);
        }
        return;
      }

      relevantTrendRows.push(row);
    });
    console.log("FILTERED DATA:", relevantTrendRows.length);
    console.log("Filters:", vehicle, selectedLocationForLegacyFilters, [selectedPickupDate, selectedDropoffDate]);

    setTrendDashboard(
      buildDashboardFromRows({
        rows: relevantTrendRows,
        config,
        adjustment,
        selectedDate: selectedPickupDate,
        selectedVehicle: vehicle,
        selectedPickupLocation: appliedPickupLocation,
        selectedDropoffLocation: appliedDropoffLocation || appliedPickupLocation
      })
    );
  }, [
    adjustment,
    selectedLocationForLegacyFilters,
    trendData,
    selectedPickupDate,
    selectedDropoffDate,
    vehicle,
    appliedPickupLocation,
    appliedDropoffLocation
  ]);

  const dropoffOptions = Array.from(
    new Set(
      rows
        .filter(
          (row) =>
            row.dateKey === pickupDate &&
            row.company === "elementsworld" &&
            normalizeVehicleKey(row.vehicle) === normalizeVehicleKey(vehicle)
        )
        .map((row) => row.dropoffDateKey)
        .filter(Boolean)
    )
  ).sort();

  useEffect(() => {
    if (selectedDropoffDate && !dropoffOptions.includes(selectedDropoffDate)) {
      setSelectedDropoffDate("");
    }
  }, [selectedDropoffDate, dropoffOptions]);

  useEffect(() => {
    if (!rows.length || pickupDate || dropoffDate) {
      return;
    }

    if (vehicle) {
      return;
    }

    const bestRow = selectDefaultElementsRow(rows);

    if (!bestRow) {
      console.warn("No valid non-Trek Elements rows found for default");
      return;
    }

    setVehicle(normalizeVehicle(bestRow.vehicle));
    setSelectedPickupDate(bestRow.dateKey);
    setSelectedDropoffDate(bestRow.dropoffDateKey);
  }, [rows, pickupDate, dropoffDate, vehicle]);

  useEffect(() => {
    if (!pickupDate) {
      return;
    }

    const matchingRows = rows.filter(
      (row) =>
        row.dateKey === pickupDate &&
        row.company === "elementsworld" &&
        normalizeVehicleKey(row.vehicle) === normalizeVehicleKey(vehicle)
    );

    if (
      selectedDropoffDate &&
      matchingRows.some((row) => row.dropoffDateKey === selectedDropoffDate)
    ) {
      return;
    }

    if (!isDropoffUserSelected && matchingRows.length > 0) {
      setSelectedDropoffDate(matchingRows[0].dropoffDateKey);
    }
  }, [pickupDate, selectedDropoffDate, isDropoffUserSelected, vehicle, rows]);

  const exactTripMetrics = buildExactTripMetrics({
    rows,
    selectedPickup: selectedPickupDate,
    selectedDropoff: selectedDropoffDate,
    selectedVehicle: vehicle,
    selectedLocation: selectedLocationForLegacyFilters
  });
  const effectivePickupRouteFilter = appliedPickupLocation || selectedLocationForLegacyFilters || "";
  const effectiveDropoffRouteFilter = appliedDropoffLocation || effectivePickupRouteFilter || "";
  const competitorQuoteSnapshot = buildCompetitorQuoteSnapshot({
    rows,
    selectedPickup: selectedPickupDate,
    selectedDropoff: selectedDropoffDate,
    selectedVehicle: vehicle,
    selectedLocation: selectedLocationForLegacyFilters,
    selectedPickupLocation: effectivePickupRouteFilter,
    selectedDropoffLocation: effectiveDropoffRouteFilter
  });
  const mappedCompetitorTokens = getMappedCompetitors(vehicle);
  const selectedTripRows = rows.filter(
    (row) =>
      (!selectedPickupDate || row.dateKey === selectedPickupDate) &&
      (!selectedDropoffDate || row.dropoffDateKey === selectedDropoffDate) &&
      matchesCompetitorRouteSelection(row, {
        selectedPickupLocation: effectivePickupRouteFilter,
        selectedDropoffLocation: effectiveDropoffRouteFilter,
        selectedLocation: selectedLocationForLegacyFilters
      })
  );
  const selectedElementsRow = selectedTripRows
    .filter(
      (row) =>
        normalize(row.company) === "elementsworld" &&
        (!vehicle || normalizeVehicleKey(row.vehicle) === normalizeVehicleKey(vehicle))
    )
    .reduce((latest, row) => (!latest || compareRowFreshness(row, latest) >= 0 ? row : latest), null);
  const competitorCandidates = selectedTripRows.filter((row) => {
      if (normalize(row.company) === "elementsworld") {
        return false;
      }

      const normalizedVehicle = normalizeVehicle(row.vehicle);
      const competitorLookup = normalize(`${row.company} ${normalizedVehicle}`);
      const competitorVehicleOnlyLookup = normalize(normalizedVehicle);

      return mappedCompetitorTokens.some(
        (token) =>
          competitorLookup.includes(token) || competitorVehicleOnlyLookup.includes(token)
      );
    });

  const canonicalizedCompetitorCandidates = (() => {
    const grouped = new Map();

    competitorCandidates.forEach((row) => {
      const key = [buildCanonicalTripKey(row), row.company, normalizeVehicleName(row.vehicle)].join("|");
      const lineageKey = [String(row.rawPickupDate || "").trim(), String(row.rawDropoffDate || "").trim()].join("|");
      const existing = grouped.get(key) || [];
      existing.push({ row, lineageKey });
      grouped.set(key, existing);
    });

    const winners = [];
    const debug = [];

    grouped.forEach((entries, key) => {
      const lineageCounts = entries.reduce((acc, entry) => {
        acc[entry.lineageKey] = (acc[entry.lineageKey] || 0) + 1;
        return acc;
      }, {});

      const winnerEntry = entries.reduce((best, candidate) => {
        if (!best) {
          return candidate;
        }

        const bestRawMatch = rowMatchesSelectedRawTripLineage(
          best.row,
          selectedPickupDate,
          selectedDropoffDate
        );
        const candidateRawMatch = rowMatchesSelectedRawTripLineage(
          candidate.row,
          selectedPickupDate,
          selectedDropoffDate
        );

        if (candidateRawMatch && !bestRawMatch) {
          return candidate;
        }
        if (bestRawMatch && !candidateRawMatch) {
          return best;
        }

        const freshnessDiff = compareRowFreshness(candidate.row, best.row);
        if (freshnessDiff > 0) {
          return candidate;
        }

        return best;
      }, null);

      if (winnerEntry) {
        winners.push(winnerEntry.row);
        debug.push({
          key,
          canonicalTripKey: buildCanonicalTripKey(winnerEntry.row),
          company: winnerEntry.row.company,
          vehicle: normalizeVehicleName(winnerEntry.row.vehicle),
          rawTripKey: winnerEntry.lineageKey,
          lineageCounts
        });
      }
    });

    return winners;
  })();

  const latestCompetitorRows = selectLatestCompetitorRows(canonicalizedCompetitorCandidates)
    .filter(isValidCompetitorPriceRow)
    .map((row) => {
      const durationDays = getRowDurationDays(row);
      const dailyRate = calculateDailyRate(row.price, durationDays);

      return {
        ...row,
        normalizedVehicle: normalizeVehicleName(row.vehicle),
        durationDays,
        dailyRate
      };
    })
    .sort((left, right) => Number(left.dailyRate ?? Infinity) - Number(right.dailyRate ?? Infinity));
  const finalDisplayRows = buildQuoteTableRows({
    elementsRow: selectedElementsRow,
    competitorRows: latestCompetitorRows
  });
  const elementsRow = finalDisplayRows.find((row) => row.isElements) || null;
  const quoteTableRows = finalDisplayRows;
  const quoteRows = finalDisplayRows.filter((row) => !row.isElements);
  const showNoTripData = Boolean(
    selectedPickupDate && selectedDropoffDate && !exactTripMetrics.hasExactMatch
  );

  const activeConfig = vehicleConfigs[vehicle] || vehicleConfigs["trek budget"];
  const elementsPrice =
    elementsRow && Number.isFinite(Number(elementsRow.price)) ? Number(elementsRow.price) : null;
  const validCompetitorRows = quoteRows.filter(isValidCompetitorPriceRow);
  const competitorRows = validCompetitorRows;
  const competitorDailyRates = validCompetitorRows
    .map((row) => Number(row.dailyRate))
    .filter((price) => Number.isFinite(price) && price > 10);
  const marketAverage = competitorDailyRates.length ? averageFrom(competitorDailyRates) : null;
  const competitorCount = competitorRows.length;
  const cheapestCompetitor =
    competitorDailyRates.length > 0 ? Math.min(...competitorDailyRates) : null;
  const highestCompetitor =
    competitorDailyRates.length > 0 ? Math.max(...competitorDailyRates) : null;
  const cheapestCompetitorRow =
    competitorDailyRates.length > 0
      ? competitorRows.reduce((min, row) =>
          Number(row.dailyRate) < Number(min.dailyRate) ? row : min
        )
      : null;
  const highestCompetitorRow =
    competitorDailyRates.length > 0
      ? competitorRows.reduce((max, row) =>
          Number(row.dailyRate) > Number(max.dailyRate) ? row : max
        )
      : null;
  const elementsDailyRate = elementsRow?.dailyRate ?? null;
  const hasElementsPrice =
    elementsPrice !== null && elementsPrice !== undefined && !Number.isNaN(elementsPrice);
  const hasCompetitorData = competitorDailyRates.length > 0;
  const hasCompetitors = competitorDailyRates.length > 0;
  let recommendationBaselinePrice = null;
  let recommendationReasonMessage = "No competitor data available. Using Elements price as fallback";
  let recommendationSource = null;

  if (hasCompetitors) {
    if (
      hasElementsPrice &&
      cheapestCompetitor !== null &&
      cheapestCompetitor < Number(elementsPrice)
    ) {
      recommendationBaselinePrice = cheapestCompetitor;
      recommendationReasonMessage = "Using cheapest competitor as baseline";
      recommendationSource = "competitor";
    } else {
      recommendationBaselinePrice =
        elementsDailyRate !== null && elementsDailyRate !== undefined
          ? elementsDailyRate
          : null;
      recommendationReasonMessage =
        "All competitors priced above Elements. Using Elements price as baseline";
      recommendationSource = hasElementsPrice ? "elements" : null;
    }
  } else {
    recommendationBaselinePrice =
      elementsDailyRate !== null && elementsDailyRate !== undefined ? elementsDailyRate : null;
    recommendationReasonMessage = "No competitor data available. Using Elements price as fallback";
    recommendationSource = hasElementsPrice ? "elements" : null;
  }

  const noCompetitorsCheaperThanElements =
    hasCompetitorData && hasElementsPrice && cheapestCompetitor >= Number(elementsPrice);
  const competitorStatusMessage = hasCompetitorData
    ? "No competitors cheaper than Elements"
    : "No competitor data available for selected date";
  const recommendedPricing = calculateRecommendedPrice(
    recommendationBaselinePrice,
    elementsRow?.durationDays ?? null,
    adjustment
  );
  const recommendedDailyRate =
    recommendedPricing.recommendedDailyRate === null ||
    recommendedPricing.recommendedDailyRate === undefined ||
    Number.isNaN(recommendedPricing.recommendedDailyRate)
      ? null
      : Math.round(recommendedPricing.recommendedDailyRate);
  const recommendedPrice =
    recommendationBaselinePrice === null ||
    recommendationBaselinePrice === undefined
      ? null
      : recommendedPricing.recommendedTotalPrice === null ||
        recommendedPricing.recommendedTotalPrice === undefined ||
        Number.isNaN(recommendedPricing.recommendedTotalPrice)
      ? null
      : Math.round(recommendedPricing.recommendedTotalPrice);
  const recommendationDetail = recommendationReasonMessage;
  const marketGap =
    elementsDailyRate !== null && marketAverage !== null
      ? elementsDailyRate - marketAverage
      : null;
  const hasMarketAverage =
    marketAverage !== null &&
    marketAverage !== undefined &&
    !Number.isNaN(marketAverage) &&
    marketAverage !== 0;
  const pricingDiffPercent =
    elementsDailyRate !== null && elementsDailyRate !== undefined && hasMarketAverage
      ? ((elementsDailyRate - marketAverage) / marketAverage) * 100
      : null;
  const pricingPositioningInsight =
    pricingDiffPercent === null
      ? "Pricing position unavailable for this selection"
      : pricingDiffPercent < 0
      ? `Elements is ${formatPercentValue(Math.abs(pricingDiffPercent))} below the competitor daily average.`
      : pricingDiffPercent > 0
      ? `Elements is ${formatPercentValue(Math.abs(pricingDiffPercent))} above the competitor daily average.`
      : "Elements is priced in line with the competitor daily average.";
  const actionThresholdPercent = 5;
  const recommendedActionInsight =
    pricingDiffPercent === null
      ? "Maintain current price"
      : pricingDiffPercent <= -actionThresholdPercent
      ? `Increase daily rate by ${formatPercentValue(Math.abs(pricingDiffPercent))}`
      : pricingDiffPercent >= actionThresholdPercent
      ? `Reduce daily rate by ${formatPercentValue(Math.abs(pricingDiffPercent))}`
      : "Maintain current daily rate";
  const marketRangeInsight =
    competitorDailyRates.length === 0
      ? "No competitor data available for selected date"
    : cheapestCompetitor === highestCompetitor
      ? `Market daily rate: ${formatCurrency(cheapestCompetitor)}/day`
      : `Market daily rate range: ${formatCurrency(cheapestCompetitor)}/day - ${formatCurrency(highestCompetitor)}/day`;
  const confidenceMessage =
    competitorDailyRates.length <= 1
      ? "Limited market data - only 1 competitor available"
      : `High confidence (${competitorDailyRates.length} competitors)`;
  const companyStats = Array.from(
    competitorRows.reduce((accumulator, row) => {
      const current = accumulator.get(row.company) || {
        company: row.company,
        prices: [],
        vehicles: new Set()
      };

      current.prices.push(Number(row.dailyRate));
      current.vehicles.add(row.vehicle);
      accumulator.set(row.company, current);
      return accumulator;
    }, new Map())
      .values()
  )
    .map((entry) => ({
      company: entry.company,
      average: averageFrom(entry.prices),
      vehicles: Array.from(entry.vehicles).join(", "),
      count: entry.prices.length
    }))
    .sort((left, right) => left.average - right.average);
  const recommendedDelta =
    recommendedDailyRate !== null &&
    elementsDailyRate !== null &&
    elementsDailyRate !== undefined
      ? recommendedDailyRate - Number(elementsDailyRate)
      : null;
  const recommendedDeltaPercent =
    recommendedDelta !== null && elementsDailyRate !== null && Number(elementsDailyRate) !== 0
      ? (recommendedDelta / Number(elementsDailyRate)) * 100
      : null;
  const recommendedActionText =
    recommendedDailyRate === null
      ? "No recommendation available"
      : recommendedDelta === null || Math.abs(recommendedDelta) < 0.5
      ? `Maintain daily rate at ${formatCurrency(recommendedDailyRate)}/day (0.0%)`
      : `${recommendedDelta > 0 ? "Increase" : "Decrease"} daily rate to ${formatCurrency(
          recommendedDailyRate
        )} (${recommendedDeltaPercent > 0 ? "+" : ""}${formatPercentValue(
          recommendedDeltaPercent
        )})`;
  const monthlyMarketAverages = Array.from(
    dashboard.trend.reduce((accumulator, item) => {
      const key = String(item.dateKey || "").slice(0, 7);

      if (!key) {
        return accumulator;
      }

      const marketValue =
        item.lowest !== null &&
        item.lowest !== undefined &&
        item.highest !== null &&
        item.highest !== undefined
          ? averageFrom([item.lowest, item.highest])
          : item.lowest ?? item.highest ?? null;

      if (marketValue === null || marketValue === undefined || Number.isNaN(marketValue)) {
        return accumulator;
      }

      const existing = accumulator.get(key) || [];
      existing.push(marketValue);
      accumulator.set(key, existing);
      return accumulator;
    }, new Map())
      .entries()
  )
    .map(([key, values]) => ({
      key,
      average: values.length ? averageFrom(values) : null
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
  const monthComparisonPair = (() => {
    const mayToJunePairs = [];

    for (let index = 0; index < monthlyMarketAverages.length - 1; index += 1) {
      const current = monthlyMarketAverages[index];
      const next = monthlyMarketAverages[index + 1];
      const sameYear = current.key.slice(0, 4) === next.key.slice(0, 4);
      const mayToJune = current.key.slice(5) === "05" && next.key.slice(5) === "06";

      if (sameYear && mayToJune) {
        mayToJunePairs.push([current, next]);
      }
    }

    if (mayToJunePairs.length) {
      return mayToJunePairs[mayToJunePairs.length - 1];
    }

    if (monthlyMarketAverages.length >= 2) {
      return [
        monthlyMarketAverages[monthlyMarketAverages.length - 2],
        monthlyMarketAverages[monthlyMarketAverages.length - 1]
      ];
    }

    return null;
  })();
  const trendInsight = (() => {
    if (!monthComparisonPair) {
      return "Not enough monthly data to calculate trend insight";
    }

    const [fromMonth, toMonth] = monthComparisonPair;

    if (
      fromMonth.average === null ||
      fromMonth.average === undefined ||
      Number.isNaN(fromMonth.average) ||
      fromMonth.average === 0 ||
      toMonth.average === null ||
      toMonth.average === undefined ||
      Number.isNaN(toMonth.average)
    ) {
      return "Not enough monthly data to calculate trend insight";
    }

    const changePercent = ((toMonth.average - fromMonth.average) / fromMonth.average) * 100;
    const fromLabel = new Intl.DateTimeFormat("en-NZ", {
      month: "long",
      year: "numeric"
    }).format(new Date(`${fromMonth.key}-01T00:00:00`));
    const toLabel = new Intl.DateTimeFormat("en-NZ", {
      month: "long",
      year: "numeric"
    }).format(new Date(`${toMonth.key}-01T00:00:00`));

    if (changePercent > 0) {
      return `Daily market rates increased from ${fromLabel} to ${toLabel} by ${formatPercentValue(changePercent)}`;
    }

    if (changePercent < 0) {
      return `Daily market rates decreased from ${fromLabel} to ${toLabel} by ${formatPercentValue(changePercent)}`;
    }

    return `Daily market rates were unchanged from ${fromLabel} to ${toLabel}`;
  })();
  const trendSelectedPoint = selectedPickupDate
    ? trendDashboard.trend.find((item) => item.dateKey === selectedPickupDate) || null
    : null;
  const trendHoveredPoint = trendActiveDateKey
    ? trendDashboard.trend.find((item) => item.dateKey === trendActiveDateKey) || null
    : null;
  const trendLatestPoint = trendDashboard.trend.length
    ? trendDashboard.trend[trendDashboard.trend.length - 1]
    : null;
  const trendDecisionPoint = trendHoveredPoint || trendSelectedPoint || trendLatestPoint;
  const trendCheapestRate = trendDecisionPoint?.lowest ?? null;
  const trendHighestRate = trendDecisionPoint?.highest ?? null;
  const trendRecommendedRate = trendDecisionPoint?.recommended ?? null;
  const trendElementsRate = trendDecisionPoint?.elements ?? null;
  const trendDecisionMarketAverage =
    trendCheapestRate !== null &&
    trendCheapestRate !== undefined &&
    trendHighestRate !== null &&
    trendHighestRate !== undefined
      ? averageFrom([trendCheapestRate, trendHighestRate])
      : trendCheapestRate ?? trendHighestRate ?? null;
  const trendDecisionGap =
    trendElementsRate !== null &&
    trendElementsRate !== undefined &&
    trendDecisionMarketAverage !== null &&
    trendDecisionMarketAverage !== undefined
      ? trendElementsRate - trendDecisionMarketAverage
      : null;
  const latestRun = scraperStatus.latestRun;
  const isScrapeRunActive =
    scrapeSubmitting ||
    Boolean(scraperStatus.activeRunId) ||
    latestRun?.status === "queued" ||
    latestRun?.status === "running";
  const runStatusLabel = latestRun?.status || "idle";
  const rowsInsertedMessage =
    latestRun?.status === "completed"
      ? Number(latestRun?.rowsInserted || 0) === 0
        ? "No new data (already exists)"
        : `${formatCount(latestRun?.rowsInserted || 0)} new rows inserted`
      : "";
  const cheapestQuoteRow = quoteTableRows.find((row) => !row.isElements) || null;
  const cheapestCompetitorPrice =
    cheapestQuoteRow && Number.isFinite(Number(cheapestQuoteRow.dailyRate))
      ? Number(cheapestQuoteRow.dailyRate)
      : null;
  const highestQuoteRow =
    quoteTableRows.length > 0
      ? [...quoteTableRows]
          .filter((row) => !row.isElements)
          .sort((left, right) => Number(right.dailyRate) - Number(left.dailyRate))[0] || null
      : null;
  const actionTone =
    recommendedActionInsight.startsWith("Increase")
      ? "up"
      : recommendedActionInsight.startsWith("Reduce")
      ? "down"
      : "neutral";

  if (typeof window !== "undefined") {
    window.__pricingDebug = {
      selectedPickupDate,
      selectedDropoffDate,
      vehicle,
      selectedTripRows: selectedTripRows.map((row) => ({
        company: row.company,
        vehicle: row.vehicle,
        price: row.price,
        scrapeDate: row.scrapeDate,
        pickupLocation: row.pickupLocation,
        dropoffLocation: row.dropoffLocation,
        type: row.type,
        id: row.id
      })),
      latestCompetitorRows: latestCompetitorRows.map((row) => ({
        company: row.company,
        vehicle: row.vehicle,
        price: row.price,
        scrapeDate: row.scrapeDate,
        pickupLocation: row.pickupLocation,
        dropoffLocation: row.dropoffLocation,
        id: row.id
      })),
      finalDisplayRows: finalDisplayRows.map((row) => ({
        company: row.company,
        vehicle: row.vehicle,
        price: row.price,
        isElements: row.isElements,
        scrapeDate: row.scrapeDate,
        pickupLocation: row.pickupLocation,
        dropoffLocation: row.dropoffLocation,
        id: row.id
      }))
    };
  }

  useEffect(() => {
    setIsUiTransitioning(true);
    const timer = window.setTimeout(() => setIsUiTransitioning(false), 220);
    return () => window.clearTimeout(timer);
  }, [activeTab]);

  if (loading) {
    return <div style={{ padding: "20px" }}>Loading dashboard...</div>;
  }

  if (loadError) {
    return (
      <div style={{ padding: "20px" }}>
        <h3>Dashboard failed to load</h3>
        <p>{loadError}</p>
        <p>Failed to fetch data from API</p>
      </div>
    );
  }

  const toggleScrapeRoute = (nextRoute) => {
    setScrapeSelectedRoutes((current) =>
      current.includes(nextRoute)
        ? current.filter((route) => route !== nextRoute)
        : [...current, nextRoute]
    );
  };

  const refreshDataset = () => {
    setDataReloadTrigger((current) => current + 1);
  };

  const triggerScrape = async () => {
    const locationsToRun = scrapeLocations;
    const routePairsToRun = scrapeRoutePairs;

    if (!locationsToRun.length || !routePairsToRun.length) {
      setScrapeRunFeedback("Select at least one route combination");
      return;
    }

    setScrapeSubmitting(true);

    try {
      const requestPayload = {
        pickupDate: scrapePickupDate,
        locations: locationsToRun,
        routePairs: routePairsToRun,
        maxTripDays: scrapeMaxTripDays,
        headless: scrapeHeadless
      };
      console.log("[SCRAPER][RUN-PAYLOAD]", {
        selectedRoutes: scrapeSelectedRoutes,
        pickupLocation: routePairsToRun[0]?.pickupLocation ?? null,
        dropoffLocation: routePairsToRun[0]?.dropoffLocation ?? null,
        routePairs: routePairsToRun,
        locations: locationsToRun
      });
      const response = await fetch(`${SCRAPER_API_BASE}/api/runs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestPayload)
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Scrape request failed");
      }

      setScrapeRunFeedback(`Scraper started... Run ID: ${payload.id}`);
      setScraperStatus((current) => ({
        ...current,
        activeRunId: payload.id,
        latestRun: {
          ...payload,
          status: "queued"
        },
        error: ""
      }));
    } catch (error) {
      setScraperStatus((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Scrape request failed"
      }));
      setScrapeRunFeedback("");
    } finally {
      setScrapeSubmitting(false);
    }
  };

  return (
    <div className="dashboard-shell">
      <div className="dashboard-backdrop dashboard-backdrop--left" />
      <div className="dashboard-backdrop dashboard-backdrop--right" />

      <main className="dashboard">
        <section className="hero-panel">
          <div className="hero-copy">
            <span className="eyebrow">AI-assisted pricing platform</span>
            <h1>AI-Assisted Pricing Decision Support</h1>
            <p className="hero-copy__subtle">
              Competitor pricing analysis and real-time insights to support pricing decisions
            </p>
            <p>
              Track how {activeConfig.label.toLowerCase()} sits against the market,
              protect margin, and adjust rate guidance without losing sight of
              location-specific camper demand.
            </p>

            <div className="hero-metadata">
              <div>
                <span className="hero-metadata__label">Selected vehicle</span>
                <strong>{activeConfig.label}</strong>
              </div>
              <div>
                <span className="hero-metadata__label">Market focus</span>
                <strong>{routeLabel}</strong>
              </div>
            </div>
          </div>

          <aside className="hero-highlight">
            <p className="hero-highlight__label">Pricing posture</p>
            <strong>
              {recommendedDailyRate === null ? "N/A" : `${formatCurrency(recommendedDailyRate)}/day`}
            </strong>
            <p className="hero-highlight__detail">
              {recommendationDetail}
            </p>
            <div className="hero-highlight__meter">
              <span>Market avg</span>
              <div className="hero-highlight__rail">
                <div
                  className="hero-highlight__fill"
                  style={{
                    width: `${Math.min(
                      100,
                      marketAverage && recommendedDailyRate
                        ? (recommendedDailyRate / marketAverage) * 65
                        : 0
                    )}%`
                  }}
                />
              </div>
              <span>Guidance</span>
            </div>
          </aside>
        </section>

        <section className="control-panel">
          <div className="control-panel__block">
            <span className="control-panel__label">Vehicle class</span>
            <div className="chip-row">
              {Object.entries(vehicleConfigs).map(([key, config]) => (
                <FilterChip
                  key={key}
                  active={key === vehicle}
                  onClick={() => setVehicle(key)}
                >
                  {config.label}
                </FilterChip>
              ))}
            </div>
          </div>

          <div className="control-panel__grid">
            <label className="field">
              <span>Pickup location</span>
              <select value={pendingPickupLocation} onChange={handlePickupLocationChange}>
                {routeLocationOptions
                  .filter((option) => option.value)
                  .map((option) => (
                  <option key={option.value || "all"} value={option.value}>
                    {option.label}
                  </option>
                  ))}
              </select>
            </label>

            <label className="field">
              <span>Dropoff location</span>
              <select value={pendingDropoffLocation} onChange={handleDropoffLocationChange}>
                {routeLocationOptions.map((option) => (
                  <option key={`dropoff-${option.value || "all"}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Pickup date</span>
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="DD/MM/YYYY"
                  value={pickupDateInputValue}
                  onChange={handlePickupDateInputChange}
                  onClick={() => openNativeDatePicker(pickupDateInputRef)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openNativeDatePicker(pickupDateInputRef);
                    }
                  }}
                />
                <input
                  ref={pickupDateInputRef}
                  type="date"
                  value={selectedPickupDate}
                  onChange={handlePickupDateChange}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    opacity: 0,
                    width: 1,
                    height: 1,
                    pointerEvents: "none"
                  }}
                />
              </div>
            </label>

            <label className="field">
              <span>Dropoff date</span>
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="DD/MM/YYYY"
                  value={dropoffDateInputValue}
                  onChange={handleDropoffDateInputChange}
                  onClick={() => openNativeDatePicker(dropoffDateInputRef)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openNativeDatePicker(dropoffDateInputRef);
                    }
                  }}
                />
                <input
                  ref={dropoffDateInputRef}
                  type="date"
                  value={selectedDropoffDate}
                  onChange={handleDropoffDateChange}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    opacity: 0,
                    width: 1,
                    height: 1,
                    pointerEvents: "none"
                  }}
                />
              </div>
            </label>

            <label className="field">
              <span>Margin adjustment</span>
              <input
                type="number"
                min="-20"
                max="30"
                value={adjustment}
                onChange={(event) => setAdjustment(Number(event.target.value))}
              />
            </label>
          </div>
        </section>

        <div className="tabs">
          <button
            className={activeTab === "overview" ? "active" : ""}
            onClick={() => setActiveTab("overview")}
          >
            Overview
          </button>
          <button
            className={activeTab === "trend" ? "active" : ""}
            onClick={() => setActiveTab("trend")}
          >
            Trend
          </button>
          <button
            className={activeTab === "competitors" ? "active" : ""}
            onClick={() => setActiveTab("competitors")}
          >
            Competitors
          </button>
          <button
            className={activeTab === "insights" ? "active" : ""}
            onClick={() => setActiveTab("insights")}
          >
            AI Insights
          </button>
        </div>
        <div className="tab-content">
          {showNoTripData ? (
            <section className="panel">
              <p>No data available for selected trip</p>
            </section>
          ) : null}

          {competitorDailyRates.length === 0 ? (
            <section className="panel">
              <p>No competitor data available for selected date</p>
            </section>
          ) : null}

          {activeTab === "overview" ? (
            <>
            <section className="stats-grid">
          <StatCard
            label="Elements Price"
            value={formatCurrency(elementsPrice)}
            detail={
              pricingDiffPercent === null
                ? "vs market avg: Not available"
                : `vs market avg: ${pricingDiffPercent > 0 ? "+" : ""}${formatPercentValue(
                    pricingDiffPercent
                  )}`
            }
            tone="forest"
          />
          <StatCard
            label="Duration"
            value={
              elementsRow?.durationDays !== null &&
              elementsRow?.durationDays !== undefined &&
              Number.isFinite(elementsRow?.durationDays) &&
              elementsRow?.durationDays > 0
                ? `${elementsRow.durationDays} days`
                : "No data"
            }
            detail="Calculated from pickup and dropoff dates"
            tone="sand"
          />
          <StatCard
            label="Daily rate"
            value={
              elementsRow?.dailyRate === null || elementsRow?.dailyRate === undefined
                ? "No data"
                : `${formatCurrency(elementsRow.dailyRate)}/day`
            }
            detail="Total price divided by trip duration"
            tone="canyon"
          />
          <StatCard
            label="Recommended daily rate"
            value={
              recommendedDailyRate === null ? "N/A" : `${formatCurrency(recommendedDailyRate)}/day`
            }
            detail="AI suggestion based on competitor daily-rate baseline"
            tone="recommended"
          />
            <StatCard
              label="Lowest market (competitor) daily rate"
              value={cheapestCompetitor === null ? "No data" : `${formatCurrency(cheapestCompetitor)}/day`}
              detail={
                competitorDailyRates.length === 0
                  ? "No competitor data available for selected date"
                  : noCompetitorsCheaperThanElements
                  ? "No competitors cheaper than Elements"
                  : cheapestCompetitorRow
                  ? `${cheapestCompetitorRow.company} \u2022 ${cheapestCompetitorRow.vehicle}`
                  : competitorStatusMessage
              }
              tone="canyon"
            />
          <StatCard
            label="Daily market average"
            value={marketAverage === null ? "No data" : `${formatCurrency(marketAverage)}/day`}
            detail="Average competitor daily rate for the current quote set"
          />
          <StatCard
            label="Highest competitor daily rate"
            value={highestCompetitor === null ? "No data" : `${formatCurrency(highestCompetitor)}/day`}
            detail={
              highestCompetitorRow
                ? `${highestCompetitorRow.company} \u2022 ${highestCompetitorRow.vehicle}`
                : `Based on ${formatCount(
                    competitorCount
                  )} competitors`
            }
            tone="amber"
          />
          <StatCard
            label="Tracked pickups"
            value={formatCount(dashboard.summary.trackedDates)}
            detail={`${formatCount(dashboard.summary.observedQuotes)} competitor observations`}
          />
            </section>

            <section className="insight-strip">
              <article className="insight-card">
                <span className="insight-card__label">Vehicle story</span>
                <h2>{activeConfig.narrative}</h2>
                <p>
                  The dashboard compares Elements pricing against the most relevant
                  camper alternatives for this class instead of blending the whole market.
                </p>
              </article>

              <article className="insight-card">
                <span className="insight-card__label">Rate signal</span>
                <h2>
                  {cheapestCompetitor === null
                    ? "No competitor daily-rate signal"
                    : `${formatCurrency(cheapestCompetitor)}/day cheapest competitor`}
                </h2>
                <p>
                  Current guidance lands at{" "}
                  {recommendedDailyRate === null
                    ? "N/A"
                    : `${formatCurrency(recommendedDailyRate)}/day`}
                  ,{" "}
                  {recommendationSource === "competitor"
                    ? "anchored to the cheapest observed competitor for this selection."
                    : recommendationSource === "elements" && hasCompetitors
                    ? "using the Elements baseline because competitors are priced above Elements."
                    : recommendationSource === "elements"
                    ? "using the Elements baseline due to no competitor data for this selection."
                    : "awaiting a usable baseline for this selection."}
                </p>
              </article>

              <article className="insight-card">
                <span className="insight-card__label">Coverage</span>
                <h2>{dashboard.latestDateLabel}</h2>
                <p>
                  Data is rolling up from pickup-date observations in{" "}
                  {routeLabel || "both depots"}, with the latest viable competitor set used for
                  the recommendation snapshot.
                </p>
              </article>
            </section>

            <p className="coverage-note">
              Based on {competitorDailyRates.length} competitors and {quoteRows.length} quotes
            </p>

            <section className="chart-grid chart-grid--secondary">
              <article className="panel">
                <div className="panel__header">
                  <div>
                    <span className="panel__eyebrow">Market spread</span>
                    <h3>Cheapest competitor stack</h3>
                  </div>
                </div>
                <div className="chart-frame">
                  {loading ? (
                    <div className="chart-empty">{"Loading competitor mix\u2026"}</div>
                  ) : (
                    <MarketSpreadChart
                      lowest={cheapestCompetitor}
                      highest={highestCompetitor}
                      recommended={recommendedDailyRate}
                      elements={elementsDailyRate}
                      cheapestRow={cheapestCompetitorRow}
                      highestRow={highestCompetitorRow}
                    />
                  )}
                </div>
              </article>
            </section>
            </>
          ) : null}

          {activeTab === "insights" ? (
            <section className="panel">
          <div className="panel__header">
            <div>
              <span className="panel__eyebrow">Decision support</span>
              <h3>AI Insights</h3>
            </div>
          </div>
          <div className="decision-list">
            <div>
              <span>RECOMMENDED ACTION</span>
              <strong className={`action-badge action-badge--${actionTone}`}>{recommendedActionText}</strong>
              <small>
                Expected uplift:{" "}
                {recommendedDelta === null
                  ? "N/A"
                  : `${recommendedDelta >= 0 ? "+" : ""}${formatCurrency(recommendedDelta)}`}
              </small>
              <small>Confidence: {confidenceMessage}</small>
            </div>
            <div>
              <span>Price positioning</span>
              <strong>{pricingPositioningInsight}</strong>
            </div>
            <div>
              <span>Market range</span>
              <strong>{marketRangeInsight}</strong>
            </div>
            <div>
              <span>Confidence level</span>
              <strong>{confidenceMessage}</strong>
              <small>Confidence is based on market coverage for this date pair</small>
            </div>
            <div>
              <span>Trend insight</span>
              <strong>{trendInsight}</strong>
            </div>
          </div>
            </section>
          ) : null}

          {activeTab === "trend" ? (
            <section className="chart-grid">
          <article className="panel panel--wide">
            <div className="panel__header">
              <div>
                <span className="panel__eyebrow">Trend view</span>
                    <h3>Daily-rate trend vs recommended guidance</h3>
              </div>
              <div className="panel__legend">
                <span className="legend legend--elements">Elements</span>
                <span className="legend legend--market">Cheapest competitor</span>
                <span className="legend legend--market">Highest competitor</span>
                <span className="legend legend--guide">Recommended</span>
              </div>
            </div>
            <div className="chart-frame">
              {loading ? (
                <div className="chart-empty">{"Loading market history\u2026"}</div>
              ) : (
                <PriceTrendChart
                  data={trendDashboard.trend}
                  selectedPickupDate={selectedPickupDate}
                  onActiveDateChange={setTrendActiveDateKey}
                />
              )}
            </div>
          </article>

          <article className="panel panel--stack">
            <div className="panel__header">
              <div>
                <span className="panel__eyebrow">Snapshot</span>
                <h3>Decision notes</h3>
              </div>
            </div>
            <div className="decision-list">
              <div>
                <span>Positioning</span>
                <strong>
                  {trendDecisionGap === null
                    ? "No matched Elements quote"
                    : trendDecisionGap >= 0
                      ? "Priced above the market"
                      : "Priced below the market"}
                </strong>
              </div>
              <div>
                <span>Margin move</span>
                <strong>
                  {dashboard.summary.upliftPercent > 0 ? "+" : ""}
                  {dashboard.summary.upliftPercent}% pricing buffer
                </strong>
              </div>
              <div>
                <span>Cheapest signal</span>
                <strong>
                  {trendCheapestRate === null || trendCheapestRate === undefined
                    ? "No competitor data available for selected date"
                    : `${formatCurrency(trendCheapestRate)}/day`}
                </strong>
              </div>
              <div>
                <span>Highest signal</span>
                <strong>
                  {trendHighestRate !== null && trendHighestRate !== undefined
                    ? `${formatCurrency(trendHighestRate)}/day`
                    : "No competitor data available for selected date"}
                </strong>
              </div>
              <div>
                <span>Recommendation</span>
                <strong>
                  {trendRecommendedRate === null || trendRecommendedRate === undefined
                    ? "N/A"
                    : `${formatCurrency(trendRecommendedRate)}/day`}
                </strong>
              </div>
            </div>
          </article>
            </section>
          ) : null}

          {activeTab === "competitors" ? (
            <>
            <section className="chart-grid chart-grid--secondary">
              <article className="panel">
            <div className="panel__header">
              <div>
                <span className="panel__eyebrow">Operators</span>
                <h3>Competitor summary</h3>
              </div>
            </div>
            <div className="company-list">
              {companyStats.length ? (
                companyStats.map((company) => (
                  <div key={company.company} className="company-list__item">
                    <div>
                      <strong>{company.company}</strong>
                      <p>{company.vehicles}</p>
                    </div>
                    <div>
                      <strong>{formatCurrency(company.average)}/day</strong>
                      <p>{company.count} quotes</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="company-list__empty">
                  No competitor summary available for the current filters.
                </div>
              )}
            </div>
              </article>
            </section>

            <section className="panel panel--table">
          <div className="panel__header">
            <div>
              <span className="panel__eyebrow">Quote table</span>
              <h3>Competitor rows</h3>
            </div>
          </div>

          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Vehicle</th>
                  <th>Pickup</th>
                  <th>Dropoff</th>
                  <th>Duration</th>
                  <th>Price</th>
                  <th>Daily Rate</th>
                  <th>% vs Cheapest</th>
                </tr>
              </thead>
              <tbody>
                {quoteTableRows.length ? (
                  quoteTableRows.map((row) => {
                    const isCheapestCompetitor =
                      Boolean(cheapestQuoteRow) &&
                      !row.isElements &&
                      row.company === cheapestQuoteRow.company &&
                      row.vehicle === cheapestQuoteRow.vehicle &&
                      row.dailyRate === cheapestQuoteRow.dailyRate;
                    const percentDiff =
                      cheapestCompetitorPrice !== null &&
                      cheapestCompetitorPrice > 0 &&
                      Number.isFinite(Number(row.dailyRate))
                        ? ((Number(row.dailyRate) - cheapestCompetitorPrice) / cheapestCompetitorPrice) * 100
                        : null;
                    const percentClass =
                      percentDiff === null
                        ? ""
                        : Math.abs(percentDiff) < 0.0001
                        ? "percent-pill--cheapest"
                        : Math.abs(percentDiff) <= 2
                        ? "percent-pill--neutral"
                        : "percent-pill--higher";

                    return (
                      <tr
                        key={`${row.company}-${row.normalizedVehicle}-${row.dateKey}-${row.dropoffDateKey}-${row.price}`}
                        className={[
                          row.isElements ? "table-row--elements" : "",
                          isCheapestCompetitor ? "table-row--cheapest" : "",
                          highestQuoteRow &&
                          !row.isElements &&
                          row.company === highestQuoteRow.company &&
                          row.vehicle === highestQuoteRow.vehicle &&
                          row.dailyRate === highestQuoteRow.dailyRate
                            ? "table-row--highest"
                            : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <td>{row.isElements ? "Elements World" : row.company}</td>
                        <td>
                          {row.vehicle}{" "}
                          {isCheapestCompetitor ? (
                            <span className="cheapest-badge">Cheapest</span>
                          ) : null}
                        </td>
                        <td>{formatDateLabel(row.dateKey, { year: "numeric" })}</td>
                        <td>{formatDateLabel(row.dropoffDateKey, { year: "numeric" })}</td>
                        <td>
                          {row.durationDays !== null && row.durationDays !== undefined
                            ? `${row.durationDays}`
                            : "No data"}
                        </td>
                        <td>{formatCurrency(row.price)}</td>
                        <td>
                          {row.dailyRate !== null && row.dailyRate !== undefined
                            ? `${formatCurrency(row.dailyRate)}/day`
                            : "No data"}
                        </td>
                        <td>
                          {percentDiff === null ? (
                            "N/A"
                          ) : (
                            <span className={`percent-pill ${percentClass}`}>
                              {percentDiff > 0 ? "+" : ""}
                              {percentDiff.toFixed(1)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="8" className="table-empty">
                      No competitor data available for selected date
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
            </section>
            </>
          ) : null}

          {isUiTransitioning ? (
            <div className="ui-loading" aria-live="polite">
              <span className="ui-loading__spinner" />
              <span>Updating view...</span>
            </div>
          ) : null}
        </div>

        <section className="panel scraper-panel">
          <div className="panel__header">
            <div>
              <span className="panel__eyebrow">Automation</span>
              <h3>Australian Backpackers scraper</h3>
            </div>
            <div className="scraper-health">
              <span
                className={`scraper-health__pill ${
                  scraperStatus.ok ? "scraper-health__pill--ok" : "scraper-health__pill--down"
                }`}
              >
                {scraperStatus.ok ? "Service online" : "Service offline"}
              </span>
              <span>
                {latestRun
                  ? `Latest run ${latestRun.status} at ${formatDateTimeLabel(
                      latestRun.updatedAt
                    )}`
                  : "No scrape runs yet"}
              </span>
            </div>
          </div>

          <div className="scraper-panel__grid">
            <div className="scraper-panel__form" style={{ display: "grid", gap: "16px" }}>
              <div
                style={{
                  display: "grid",
                  gap: "12px",
                  padding: "14px",
                  borderRadius: "14px",
                  border: "1px solid rgba(18, 33, 64, 0.12)",
                  background: "rgba(255, 255, 255, 0.7)"
                }}
              >
                <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                  <label className="field">
                    <span>Pickup start date</span>
                    <div style={{ position: "relative" }}>
                      <input
                        type="text"
                        value={formatDisplayDate(scrapePickupDate)}
                        readOnly
                        onClick={() => openNativeDatePicker(scrapePickupDateInputRef)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openNativeDatePicker(scrapePickupDateInputRef);
                          }
                        }}
                        style={{
                          width: "100%",
                          padding: "10px",
                          borderRadius: "8px",
                          border: "1px solid #ccc",
                          cursor: "pointer"
                        }}
                      />
                      <input
                        ref={scrapePickupDateInputRef}
                        type="date"
                        value={scrapePickupDate}
                        onChange={(event) => setScrapePickupDate(event.target.value)}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          opacity: 0,
                          width: 1,
                          height: 1,
                          pointerEvents: "none"
                        }}
                      />
                    </div>
                  </label>

                  <label className="field">
                    <span>Pickup window (days)</span>
                    <input
                      type="number"
                      min="1"
                      max="30"
                      value={scrapeMaxTripDays}
                      onChange={(event) => setScrapeMaxTripDays(Number(event.target.value))}
                    />
                  </label>
                </div>

                <div style={{ display: "grid", gap: "8px" }}>
                  <span className="control-panel__label">Route selection</span>
                  <div className="chip-row" style={{ gap: "10px" }}>
                    {scrapeRouteOptions.map((entry) => {
                      const selected = scrapeSelectedRoutes.includes(entry.value);
                      return (
                        <label
                          key={entry.value}
                          className="toggle-pill"
                          style={{
                            position: "relative",
                            minHeight: "38px",
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "8px 14px",
                            borderRadius: "999px",
                            border: selected ? "1px solid rgba(17, 56, 112, 0.85)" : "1px solid rgba(18, 33, 64, 0.22)",
                            background: selected ? "rgba(17, 56, 112, 0.1)" : "rgba(255, 255, 255, 0.8)",
                            cursor: "pointer"
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleScrapeRoute(entry.value)}
                            style={{
                              position: "absolute",
                              opacity: 0,
                              width: 1,
                              height: 1,
                              pointerEvents: "none"
                            }}
                          />
                          <span style={{ fontWeight: 600 }}>{entry.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="scraper-panel__checkboxes">
                  <label className="toggle-pill">
                    <input
                      type="checkbox"
                      checked={scrapeHeadless}
                      onChange={(event) => setScrapeHeadless(event.target.checked)}
                    />
                    <span>Run in background (faster)</span>
                  </label>
                </div>
              </div>

              <div className="scraper-panel__actions" style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="action-button"
                  disabled={isScrapeRunActive || scrapeSelectedRoutes.length === 0}
                  onClick={() => triggerScrape()}
                >
                  Run price update
                </button>
                <button
                  type="button"
                  className="action-button action-button--ghost"
                  disabled={isScrapeRunActive}
                  onClick={() =>
                    setScrapeSelectedRoutes(scrapeRouteOptions.map((option) => option.value))
                  }
                >
                  Select all routes
                </button>
                <button
                  type="button"
                  className="action-button action-button--ghost"
                  onClick={refreshDataset}
                >
                  Sync latest data
                </button>
              </div>

              <div className="scraper-panel__status">
                {scrapeRunFeedback ? <p className="scraper-panel__hint">{scrapeRunFeedback}</p> : null}
                {latestRun ? (
                  <p className="scraper-panel__hint">
                    Run ID: {latestRun.id} | Status: {runStatusLabel}
                  </p>
                ) : null}
                {isScrapeRunActive ? (
                  <p className="scraper-panel__hint">
                    Scraper running... Rows processed:{" "}
                    {formatCount(latestRun?.rowsProcessed || latestRun?.rowsCaptured || 0)} | Dates visited:{" "}
                    {formatCount(latestRun?.datesVisited || 0)}
                  </p>
                ) : null}
              </div>

              {scraperStatus.error ? (
                <p className="scraper-panel__hint">Backend not connected yet</p>
              ) : (
                <p className="scraper-panel__hint">
                  Runs are fully automated in Playwright and write into the shared pricing
                  database, with dashboard views loaded through the pricing API.
                </p>
              )}
            </div>

            <div className="scraper-panel__summary">
              <div className="scraper-stat">
                <span>Total dataset rows</span>
                <strong>
                  {formatCount(latestRun?.totalRows || scraperStatus.dataset.rowCount || 0)}
                </strong>
              </div>
              <div className="scraper-stat">
                <span>Latest pickup in dataset</span>
                <strong>
                  {scraperStatus.dataset.latestPickupDate
                    ? formatDateLabel(scraperStatus.dataset.latestPickupDate, {
                        year: "numeric"
                      })
                    : "Not available"}
                </strong>
              </div>
              <div className="scraper-stat">
                <span>Latest scrape date</span>
                <strong>
                  {scraperStatus.dataset.latestScrapeDate
                    ? formatDateLabel(scraperStatus.dataset.latestScrapeDate, {
                        year: "numeric"
                      })
                    : "Not available"}
                </strong>
              </div>
              <div className="scraper-stat">
                <span>Rows processed this run</span>
                <strong>{formatCount(latestRun?.rowsProcessed || latestRun?.rowsCaptured || 0)}</strong>
              </div>
              <div className="scraper-stat">
                <span>Rows inserted this run</span>
                <strong>{formatCount(latestRun?.rowsInserted || 0)}</strong>
              </div>
              <div className="scraper-panel__last-run">
                <p className="scraper-panel__hint">
                  Last run: {latestRun?.status === "completed" ? "Completed" : runStatusLabel}
                </p>
                <p className="scraper-panel__hint">
                  New rows: {formatCount(latestRun?.rowsInserted || 0)}
                </p>
              </div>
              {rowsInsertedMessage ? (
                <p className="scraper-panel__hint">
                  {Number(latestRun?.rowsInserted || 0) === 0
                    ? "No new rows inserted (data already exists for this date range)"
                    : rowsInsertedMessage}
                </p>
              ) : null}

              <div className="scraper-panel__links">
                <a href={`${SCRAPER_API_BASE}/api/health`} target="_blank" rel="noreferrer">
                  Open scraper health
                </a>
                <a href={`${PRICING_API_BASE}/api/prices`} target="_blank" rel="noreferrer">
                  View latest data
                </a>
                {latestRun?.artifacts?.csvPath ? (
                  <a
                    href={`${SCRAPER_API_BASE}/artifacts/${latestRun.id}/rows.csv`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open latest run rows
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;












