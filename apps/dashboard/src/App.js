import { useEffect, useRef, useState } from "react";
import Papa from "papaparse";
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

const competitorMap = {
  "trek budget": ["stationwagen"],
  "trek budget camper": ["stationwagen"],
  "trek medium": ["sleeper"],
  "trek medium camper": ["sleeper"],
  "trek large": ["aventus2"],
  "trek large camper": ["aventus2"]
};

const normalize = (value) =>
  String(value || "").toLowerCase().replace(/\s+/g, "");

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
  if (compact.includes("six")) return "sixer";

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
  if (compact.includes("doubleup")) return "doubleup";
  if (compact.includes("bigsix")) return "bigsix";

  return v.trim().replace(/\s+/g, " ");
}

const normalizeVehicleMatch = (value) => normalizeVehicle(value);
const normalizeVehicleName = (name) => normalizeVehicle(name);

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
  const d = new Date(dateStr);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

const parseDate = (value) => {
  if (!value) {
    return null;
  }

  const nativeDate = new Date(value);
  if (!Number.isNaN(nativeDate.getTime())) {
    return nativeDate;
  }

  const parts = String(value).split("/");
  if (parts.length === 3) {
    const [month, day, year] = parts;
    const fallback = new Date(`${year}-${month}-${day}`);
    if (!Number.isNaN(fallback.getTime())) {
      return fallback;
    }
  }

  return null;
};

const toDateKey = (value) => {
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

export const compareScrapeDates = (left, right) => {
  const leftTime = left instanceof Date ? left.getTime() : Number.NEGATIVE_INFINITY;
  const rightTime = right instanceof Date ? right.getTime() : Number.NEGATIVE_INFINITY;
  return leftTime - rightTime;
};

export const selectLatestRowsBySnapshot = (rows) => {
  const latestByKey = new Map();

  rows.forEach((row) => {
    const key = [
      row.dateKey,
      row.dropoffDate,
      row.location,
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
  if (!row.dateKey || !row.dropoffDateKey) {
    return null;
  }

  return calculateTripDays(parseDate(row.dateKey), parseDate(row.dropoffDateKey));
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
  competitorMap[normalizeVehicle(selectedVehicle)]
    ? competitorMap[normalizeVehicle(selectedVehicle)].map((entry) => normalize(entry))
    : vehicleConfigs[normalizeVehicle(selectedVehicle)]?.competitorVehicles || [];

export const buildCompetitorQuoteSnapshot = ({
  rows,
  selectedPickup = "",
  selectedDropoff = "",
  selectedVehicle = "",
  selectedLocation = ""
}) => {
  const competitors = getMappedCompetitors(selectedVehicle);
  const filteredRows = rows.filter((row) => {
    if (normalize(row.company) === "elementsworld") {
      return false;
    }

    const normalizedVehicle = normalizeVehicle(row.vehicle);
    const normalizedSelectedVehicle = normalizeVehicle(selectedVehicle);
    const competitorLookup = normalize(`${row.company} ${normalizedVehicle}`);
    const competitorVehicleOnlyLookup = normalize(normalizedVehicle);
    const isMappedCompetitor = competitors.some(
      (competitorToken) =>
        competitorLookup.includes(competitorToken) ||
        competitorVehicleOnlyLookup.includes(competitorToken)
    );
    const matchesSelectedVehicle =
      !normalizedSelectedVehicle ||
      normalize(normalizedVehicle) === normalize(normalizedSelectedVehicle) ||
      isMappedCompetitor;

    if (!matchesSelectedVehicle) {
      return false;
    }

    if (
      competitors.length &&
      normalize(normalizedVehicle) !== normalize(normalizedSelectedVehicle) &&
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

    if (selectedLocation && row.location !== normalize(selectedLocation)) {
      return false;
    }

    return true;
  });
  const latestScrapeDate = filteredRows.reduce((latest, row) => {
    if (!(row.scrapeDate instanceof Date) || Number.isNaN(row.scrapeDate.getTime())) {
      return latest;
    }

    if (!latest || compareScrapeDates(row.scrapeDate, latest) > 0) {
      return row.scrapeDate;
    }

    return latest;
  }, null);
  const latestRows = latestScrapeDate
    ? filteredRows.filter(
        (row) =>
          row.scrapeDate instanceof Date &&
          !Number.isNaN(row.scrapeDate.getTime()) &&
          compareScrapeDates(row.scrapeDate, latestScrapeDate) === 0
      )
    : filteredRows;
  const quoteRows = dedupeQuoteRows(latestRows)
    .map((row) => {
      const durationDays = getRowDurationDays(row);
      const dailyRate =
        durationDays && Number.isFinite(durationDays) && durationDays > 0
          ? Math.round(row.price / durationDays)
          : null;

      return {
        ...row,
        normalizedVehicle: normalizeVehicleName(row.vehicle),
        durationDays,
        dailyRate
      };
    })
    .sort((left, right) => Number(left.price) - Number(right.price));
  const competitorPrices = quoteRows.map((row) => Number(row.price));
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
    rows: quoteRows,
    companyStats,
    latestScrapeDate,
    summary: {
      lowest: cheapestRow ? cheapestRow.price : null,
      average,
      highest: highestRow ? highestRow.price : null,
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
      dailyRate:
        durationDays &&
        Number.isFinite(durationDays) &&
        durationDays > 0
          ? Math.round(elementsRow.price / durationDays)
          : null
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

    return Number(left.price) - Number(right.price);
  });
};


const collectBucketMetrics = (bucket) => {
  const elementsRows = bucket?.elementsRows || [];
  const competitorRows = bucket?.competitorCandidates || [];
  const competitorPrices = competitorRows.map((row) => row.price);
  const elementsPrices = elementsRows.map((row) => row.price);
  const cheapestRow = competitorRows.length
    ? competitorRows.reduce((min, row) => (row.price < min.price ? row : min))
    : null;
  const highestRow = competitorRows.length
    ? competitorRows.reduce((max, row) => (row.price > max.price ? row : max))
    : null;

  return {
    elementsRows,
    competitorRows,
    competitorPrices,
    elementsPrices,
    cheapestRow,
    highestRow,
    lowest: cheapestRow ? cheapestRow.price : null,
    highest: highestRow ? highestRow.price : null,
    average: competitorPrices.length ? averageFrom(competitorPrices) : null,
    elements: elementsPrices.length ? averageFrom(elementsPrices) : null
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

  const recommendedTotalPrice = baselinePrice * (1 + adjustmentPercent / 100);
  const recommendedDailyRate =
    durationDays !== null &&
    durationDays !== undefined &&
    Number.isFinite(durationDays) &&
    durationDays > 0
      ? recommendedTotalPrice / durationDays
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
    const competitorLookup = normalize(`${row.company} ${normalizedRowVehicle}`);
    const competitorVehicleOnlyLookup = normalize(normalizedRowVehicle);
    const isElementsRow =
      normalize(row.company) === "elementsworld" &&
      (!normalizedSelectedVehicle ||
        normalize(normalizedRowVehicle) === normalize(normalizedSelectedVehicle));
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
  const normalizedRowVehicle = normalizeVehicleMatch(rowVehicle);
  const normalizedSelectedVehicle = normalizeVehicleMatch(selectedVehicle);
  return normalize(normalizedRowVehicle) === normalize(normalizedSelectedVehicle);
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
        normalizeVehicle(row.vehicle) === normalizeVehicle(selectedVehicle)) &&
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
  selectedVehicle = ""
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
    const bucketMetrics = collectBucketMetrics(grouped.get(dateKey));

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
          bucketMetrics.cheapestRow ? getRowDurationDays(bucketMetrics.cheapestRow) : null,
          adjustment
        );

        return recommendedPricing.recommendedTotalPrice === null ||
          recommendedPricing.recommendedTotalPrice === undefined ||
          Number.isNaN(recommendedPricing.recommendedTotalPrice)
          ? null
          : Math.round(recommendedPricing.recommendedTotalPrice);
      })(),
      competitorCount: bucketMetrics.competitorRows.length
    };
  });

  const latestDate = sortedDates.length ? sortedDates[sortedDates.length - 1] : "";
  const selectedMetrics = selectedDate
    ? collectBucketMetrics(grouped.get(selectedDate))
    : null;
  const latestMetrics = latestDate
    ? collectBucketMetrics(grouped.get(latestDate))
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
      const bucketMetrics = collectBucketMetrics(grouped.get(dateKey));
      return bucketMetrics.competitorRows;
    });
    snapshotMetrics = {
      elementsRows: sortedDates.flatMap((dateKey) => {
        const bucketMetrics = collectBucketMetrics(grouped.get(dateKey));
        return bucketMetrics.elementsRows;
      }),
      elementsPrices: sortedDates.flatMap((dateKey) => {
        const bucketMetrics = collectBucketMetrics(grouped.get(dateKey));
        return bucketMetrics.elementsPrices;
      })
    };
    displayDate = latestDate || "";
  }

  latestRows.sort((left, right) => {
    if (left.dateKey !== right.dateKey) {
      return left.dateKey.localeCompare(right.dateKey);
    }

    return left.price - right.price;
  });

  const competitorPrices = latestRows.map((row) => row.price);
  const hasCompetitors = competitorPrices.length > 0;
  const latestAverage = hasCompetitors ? averageFrom(competitorPrices) : null;
  let latestElements = snapshotMetrics?.elementsRows
    ?.filter((row) => (selectedVehicle ? isSameVehicle(row.vehicle, selectedVehicle) : true))
    .map((row) => row.price);
  latestElements = latestElements?.length
    ? averageFrom(latestElements)
    : null;
  let fallbackDate = null;

  if (!latestElements && selectedDate) {
    const fallback = findNearestElementsPrice(grouped, selectedDate, selectedVehicle);

    if (fallback) {
      latestElements = fallback.value;
      fallbackDate = fallback.date;
    }
  }
  const cheapestRow = latestRows.length
    ? latestRows.reduce((min, row) => (row.price < min.price ? row : min))
    : null;
  const highestRow = latestRows.length
    ? latestRows.reduce((max, row) => (row.price > max.price ? row : max))
    : null;
  const lowest = cheapestRow ? cheapestRow.price : null;
  const highest = highestRow ? highestRow.price : null;
  const elementsPrice = latestElements;
  const recommendationBaseline = getBaselinePrice(lowest, elementsPrice);
  const recommendedPricing = calculateRecommendedPrice(
    recommendationBaseline.baselinePrice,
    cheapestRow ? getRowDurationDays(cheapestRow) : null,
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

function PriceTrendChart({ data }) {
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

                  return series.map((entry, index) => {
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
                  });
                })()
              ) : (
                <>
                  <LinePath
                    data={elementsData}
                    curve={curveMonotoneX}
                    x={(item) => xScale(item.dateKey) ?? 0}
                    y={(item) => yScale(item.elements)}
                    stroke="#2d6a4f"
                    strokeWidth={3}
                  />
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

                  {data.map((item) => {
                    const x = xScale(item.dateKey) ?? 0;
                    const tooltip = [
                      `Date: ${formatDateLabel(item.dateKey, { year: "numeric" })}`,
                      `Cheapest: ${formatCompetitorLabel(item.cheapestRow)}`,
                      `Highest: ${formatCompetitorLabel(item.highestRow)}`,
                      `Elements: ${formatCurrency(item.elements)}`
                    ].join("\n");
                    return (
                      <g key={item.dateKey}>
                        <rect
                          x={x - 18}
                          y={0}
                          width={36}
                          height={innerHeight}
                          fill="transparent"
                        >
                          <title>{tooltip}</title>
                        </rect>
                        {item.lowest !== null ? (
                          <circle cx={x} cy={yScale(item.lowest)} r={4} fill="#c96c34" />
                        ) : null}
                        {item.highest !== null ? (
                          <circle cx={x} cy={yScale(item.highest)} r={4} fill="#d8a15d" />
                        ) : null}
                        {item.elements !== null ? (
                          <circle cx={x} cy={yScale(item.elements)} r={4} fill="#2d6a4f" />
                        ) : null}
                      </g>
                    );
                  })}
                </>
              )}
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
  const [vehicle, setVehicle] = useState("");
  const [adjustment, setAdjustment] = useState(5);
  const [location, setLocation] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedDropoff, setSelectedDropoff] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [scrapePickupDate, setScrapePickupDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [scrapeMaxTripDays, setScrapeMaxTripDays] = useState(30);
  const [scrapeLocations, setScrapeLocations] = useState([
    "auckland",
    "christchurch"
  ]);
  const [scrapeHeadless, setScrapeHeadless] = useState(true);
  const [scrapeSubmitting, setScrapeSubmitting] = useState(false);
  const [scraperStatus, setScraperStatus] = useState(initialScraperStatus);
  const pickupDateInputRef = useRef(null);
  const dropoffDateInputRef = useRef(null);
  const pickupDate = selectedDate;
  const dropoffDate = selectedDropoff;
  const handlePickupDateChange = (event) => {
    setSelectedDate(event.target.value);
  };
  const handleDropoffDateChange = (event) => {
    setSelectedDropoff(event.target.value);
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
    let cancelled = false;
    const controller = new AbortController();
    let defaultSelectionTimer = null;
    let fetchResolved = false;
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (!cancelled && !settled) {
        settled = true;
        controller.abort();
        setLoadError("CSV fetch timed out");
        setLoading(false);
      }
    }, 30000);

    const finishLoading = () => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      setLoading(false);
    };

    setLoading(true);
    setLoadError("");

    fetch("/dataset_FINAL_TrekSAFE.csv", { signal: controller.signal })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`CSV fetch failed: ${res.status}`);
        }
        return res.text();
      })
      .then((csvText) => {
        fetchResolved = true;
        window.clearTimeout(timeoutId);
        Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          worker: true,
          complete: (result) => {
            if (cancelled) return;

            try {
              const sourceRows = result.data || [];
              const cleanedRows = [];
              let index = 0;
              const chunkSize = 1200;

              const processChunk = () => {
                if (cancelled) {
                  return;
                }

                const end = Math.min(index + chunkSize, sourceRows.length);
                for (; index < end; index += 1) {
                  const row = sourceRows[index];
                  try {
                    const dateObject = parseDate(row.pickup_date_parsed || row.pickup_date);
                    const dropoffObject = parseDate(row.dropoff_date);
                    const dateKey = toDateKey(dateObject);
                    const dropoffDateKey = toDateKey(dropoffObject);
                    const price = Number(row.price);

                    if (!dateKey || !dropoffDateKey || !Number.isFinite(price)) {
                      continue;
                    }

                    cleanedRows.push({
                      dateKey,
                      dropoffDate: row.dropoff_date ? String(row.dropoff_date).trim() : "",
                      dropoffDateKey,
                      company: normalize(row.company),
                      vehicle: normalizeVehicle(row.vehicle),
                      location: normalize(row.location),
                      type: normalize(row.type),
                      price,
                      tripDays: calculateTripDays(dateObject, dropoffObject),
                      scrapeDate: parseDate(row.scrape_date)
                    });
                  } catch {
                    continue;
                  }
                }

                if (index < sourceRows.length) {
                  defaultSelectionTimer = window.setTimeout(processChunk, 0);
                  return;
                }

                setRows(cleanedRows);
                defaultSelectionTimer = window.setTimeout(() => {
                  if (cancelled) {
                    return;
                  }

                  const defaultRow = selectDefaultElementsRow(cleanedRows);
                  if (defaultRow) {
                    setVehicle(normalizeVehicle(defaultRow.vehicle));
                    setSelectedDate(defaultRow.dateKey);
                    setSelectedDropoff(defaultRow.dropoffDateKey);
                  }
                }, 0);
                finishLoading();
              };

              processChunk();
            } catch (err) {
              setLoadError(err instanceof Error ? err.message : "CSV processing failed");
              finishLoading();
            }
          },
          error: (err) => {
            if (!cancelled) {
              setLoadError(err?.message || "CSV parse failed");
              finishLoading();
            }
          }
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "CSV fetch failed");
          finishLoading();
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (!fetchResolved) {
        window.clearTimeout(timeoutId);
      }
      if (defaultSelectionTimer) {
        window.clearTimeout(defaultSelectionTimer);
      }
      settled = true;
    };
  }, []);

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
      if (location && row.location !== location) {
        return;
      }

      relevantRows.push(row);
    });

    setDashboard(
      buildDashboardFromRows({
        rows: relevantRows,
        config,
        adjustment,
        selectedDate,
        selectedVehicle: vehicle
      })
    );
  }, [adjustment, location, rows, selectedDate, vehicle]);

  const dropoffOptions = Array.from(
    new Set(
      rows
        .filter(
          (row) =>
            row.dateKey === pickupDate &&
            row.company === "elementsworld" &&
            normalizeVehicle(row.vehicle) === normalizeVehicle(vehicle)
        )
        .map((row) => row.dropoffDateKey)
        .filter(Boolean)
    )
  ).sort();

  useEffect(() => {
    if (selectedDropoff && !dropoffOptions.includes(selectedDropoff)) {
      setSelectedDropoff("");
    }
  }, [selectedDropoff, dropoffOptions]);

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
    setSelectedDate(bestRow.dateKey);
    setSelectedDropoff(bestRow.dropoffDateKey);
  }, [rows, pickupDate, dropoffDate, vehicle]);

  useEffect(() => {
    if (!pickupDate) {
      return;
    }

    const matchingRows = rows.filter(
      (row) =>
        row.dateKey === pickupDate &&
        row.company === "elementsworld" &&
        normalizeVehicle(row.vehicle) === normalizeVehicle(vehicle)
    );

    if (
      selectedDropoff &&
      matchingRows.some((row) => row.dropoffDateKey === selectedDropoff)
    ) {
      return;
    }

    if (matchingRows.length > 0) {
      setSelectedDropoff(matchingRows[0].dropoffDateKey);
    }
  }, [pickupDate, selectedDropoff, vehicle, rows]);

  const exactTripMetrics = buildExactTripMetrics({
    rows,
    selectedPickup: selectedDate,
    selectedDropoff,
    selectedVehicle: vehicle,
    selectedLocation: location
  });
  const competitorQuoteSnapshot = buildCompetitorQuoteSnapshot({
    rows,
    selectedPickup: selectedDate,
    selectedDropoff,
    selectedVehicle: vehicle,
    selectedLocation: location
  });
  const elementsRow = exactTripMetrics.selectedRow;
  const quoteTableRows = buildQuoteTableRows({
    elementsRow,
    competitorRows: competitorQuoteSnapshot.rows
  });
  const showNoTripData = Boolean(
    selectedDate && selectedDropoff && !exactTripMetrics.hasExactMatch
  );

  const activeConfig = vehicleConfigs[vehicle] || vehicleConfigs["trek budget"];
  const elementsPrice = exactTripMetrics.totalPrice;
  const cheaperCompetitorRows =
    elementsPrice !== null && elementsPrice !== undefined && !Number.isNaN(elementsPrice)
      ? competitorQuoteSnapshot.rows.filter((row) => Number(row.price) < Number(elementsPrice))
      : competitorQuoteSnapshot.rows;
  const cheaperCompetitorPrices = cheaperCompetitorRows
    .map((row) => Number(row.price))
    .filter((price) => !Number.isNaN(price));
  const cheapestCompetitorPrice =
    cheaperCompetitorPrices.length > 0 ? Math.min(...cheaperCompetitorPrices) : null;
  const currentBaseline = getBaselinePrice(
    cheapestCompetitorPrice,
    elementsPrice
  );
  const currentRecommendation = calculateRecommendedPrice(
    currentBaseline.baselinePrice,
    exactTripMetrics.duration,
    adjustment
  );
  const recommendedPriceRaw =
    currentRecommendation.recommendedTotalPrice === null ||
    currentRecommendation.recommendedTotalPrice === undefined ||
    Number.isNaN(currentRecommendation.recommendedTotalPrice)
      ? null
      : Math.round(currentRecommendation.recommendedTotalPrice);
  const recommendedPrice =
    recommendedPriceRaw === null &&
    elementsPrice !== null &&
    elementsPrice !== undefined &&
    !Number.isNaN(elementsPrice)
      ? Math.round(elementsPrice * (1 + adjustment / 100))
      : recommendedPriceRaw;
  const recommendationDetail =
    currentBaseline.source === "competitor"
      ? "Suggested rate based on cheapest competitor plus selected margin adjustment"
      : currentBaseline.source === "elements"
      ? cheaperCompetitorRows.length === 0 &&
        elementsPrice !== null &&
        elementsPrice !== undefined &&
        !Number.isNaN(elementsPrice)
        ? "No cheaper competitors. Suggested rate based on Elements price plus selected margin adjustment"
        : "Suggested rate based on Elements price plus selected margin adjustment"
      : "Insufficient competitor and Elements data";
  const recommendationSource = currentBaseline.source;
  const marketGap =
    elementsPrice !== null && competitorQuoteSnapshot.summary.average !== null
      ? elementsPrice - competitorQuoteSnapshot.summary.average
      : null;
  const cheapestCompetitor =
    cheaperCompetitorRows.length > 0
      ? cheaperCompetitorRows.reduce((min, row) =>
          Number(row.price) < Number(min.price) ? row : min
        )
      : null;
  const highestCompetitor = competitorQuoteSnapshot.summary.highestRow;
  const latestRun = scraperStatus.latestRun;

  if (loading) {
    return <div style={{ padding: "20px" }}>Loading dashboard...</div>;
  }

  if (loadError) {
    return (
      <div style={{ padding: "20px" }}>
        <h3>Dashboard failed to load</h3>
        <p>{loadError}</p>
        <p>Expected CSV path: /dataset_FINAL_TrekSAFE.csv</p>
      </div>
    );
  }

  const toggleScrapeLocation = (nextLocation) => {
    setScrapeLocations((current) =>
      current.includes(nextLocation)
        ? current.filter((entry) => entry !== nextLocation)
        : [...current, nextLocation]
    );
  };

  const refreshDataset = () => {
    window.location.reload();
  };

  const triggerScrape = async (overrideLocations) => {
    const locationsToRun = overrideLocations || scrapeLocations;

    if (!locationsToRun.length) {
      return;
    }

    setScrapeSubmitting(true);

    try {
      const response = await fetch(`${SCRAPER_API_BASE}/api/runs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          pickupDate: scrapePickupDate,
          locations: locationsToRun,
          maxTripDays: scrapeMaxTripDays,
          headless: scrapeHeadless
        })
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Scrape request failed");
      }

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
            <span className="eyebrow">Camper revenue cockpit</span>
            <h1>Modern pricing visibility for every road-trip class.</h1>
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
                <strong>{location || "All depots"}</strong>
              </div>
            </div>
          </div>

          <aside className="hero-highlight">
            <p className="hero-highlight__label">Pricing posture</p>
            <strong>
              {recommendedPrice === null ? "N/A" : formatCurrency(recommendedPrice)}
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
                      competitorQuoteSnapshot.summary.average
                        ? (recommendedPrice / competitorQuoteSnapshot.summary.average) * 65
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
              <span>Depot</span>
              <select value={location} onChange={(event) => setLocation(event.target.value)}>
                {locationOptions.map((option) => (
                  <option key={option.value || "all"} value={option.value}>
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
                  value={formatDisplayDate(selectedDate)}
                  readOnly
                  onClick={() => openNativeDatePicker(pickupDateInputRef)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openNativeDatePicker(pickupDateInputRef);
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
                  ref={pickupDateInputRef}
                  type="date"
                  value={selectedDate}
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
                  value={formatDisplayDate(selectedDropoff)}
                  readOnly
                  onClick={() => openNativeDatePicker(dropoffDateInputRef)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openNativeDatePicker(dropoffDateInputRef);
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
                  ref={dropoffDateInputRef}
                  type="date"
                  value={selectedDropoff}
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
            <div className="scraper-panel__form">
              <label className="field">
                <span>Scrape pickup date</span>
                <input
                  type="date"
                  value={scrapePickupDate}
                  onChange={(event) => setScrapePickupDate(event.target.value)}
                />
              </label>

              <label className="field">
                <span>Max trip days</span>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={scrapeMaxTripDays}
                  onChange={(event) => setScrapeMaxTripDays(Number(event.target.value))}
                />
              </label>

              <div className="scraper-panel__checkboxes">
                {locationOptions
                  .filter((entry) => entry.value)
                  .map((entry) => (
                    <label key={entry.value} className="toggle-pill">
                      <input
                        type="checkbox"
                        checked={scrapeLocations.includes(entry.value)}
                        onChange={() => toggleScrapeLocation(entry.value)}
                      />
                      <span>{entry.label}</span>
                    </label>
                  ))}

                <label className="toggle-pill">
                  <input
                    type="checkbox"
                    checked={scrapeHeadless}
                    onChange={(event) => setScrapeHeadless(event.target.checked)}
                  />
                  <span>Headless browser</span>
                </label>
              </div>

              <div className="scraper-panel__actions">
                <button
                  type="button"
                  className="action-button"
                  disabled={scrapeSubmitting || !scrapeLocations.length}
                  onClick={() => triggerScrape()}
                >
                  Run selected scrape
                </button>
                <button
                  type="button"
                  className="action-button action-button--ghost"
                  disabled={scrapeSubmitting}
                  onClick={() => triggerScrape(["auckland", "christchurch"])}
                >
                  Run both depots
                </button>
                <button
                  type="button"
                  className="action-button action-button--ghost"
                  onClick={refreshDataset}
                >
                  Refresh dashboard data
                </button>
              </div>

              {scraperStatus.error ? (
                <p className="scraper-panel__error">{scraperStatus.error}</p>
              ) : (
                <p className="scraper-panel__hint">
                  Runs are fully automated in Playwright and write back into the dashboard CSV
                  once complete.
                </p>
              )}
            </div>

            <div className="scraper-panel__summary">
              <div className="scraper-stat">
                <span>Dataset rows</span>
                <strong>{formatCount(scraperStatus.dataset.rowCount || 0)}</strong>
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
                <span>Captured rows last run</span>
                <strong>{formatCount(latestRun?.rowsCaptured || 0)}</strong>
              </div>

              <div className="scraper-panel__links">
                <a href={`${SCRAPER_API_BASE}/api/health`} target="_blank" rel="noreferrer">
                  Open scraper health
                </a>
                <a href={`${SCRAPER_API_BASE}/data/dataset_FINAL_TrekSAFE.csv`} target="_blank" rel="noreferrer">
                  Open generated dataset
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

        <div
          style={{
            background: "#eee",
            padding: "10px",
            marginTop: "10px"
          }}
        >
          <p>Default Pickup: {selectedDate ? formatDateDMY(selectedDate) : "Not selected"}</p>
          <p>
            Default Dropoff:{" "}
            {selectedDropoff ? formatDateDMY(selectedDropoff) : "Not selected"}
          </p>
        </div>

        {showNoTripData ? (
          <section className="panel">
            <p>No data available for selected trip</p>
          </section>
        ) : null}

        <section className="stats-grid">
          <StatCard
            label="Elements Price"
            value={formatCurrency(exactTripMetrics.totalPrice)}
            detail={
              exactTripMetrics.hasExactMatch
                ? "Your current selling price"
                : "Select pickup and dropoff to see your current selling price"
            }
            tone="forest"
          />
          <StatCard
            label="Duration"
            value={
              exactTripMetrics.duration !== null &&
              Number.isFinite(exactTripMetrics.duration) &&
              exactTripMetrics.duration > 0
                ? `${exactTripMetrics.duration} days`
                : "No data"
            }
            detail="Calculated from pickup and dropoff dates"
            tone="sand"
          />
          <StatCard
            label="Daily rate"
            value={
              exactTripMetrics.dailyRate === null || exactTripMetrics.dailyRate === undefined
                ? "No data"
                : `${formatCurrency(exactTripMetrics.dailyRate)}/day`
            }
            detail="Total trip price divided by duration"
            tone="canyon"
          />
          <StatCard
            label="Recommended rate"
            value={
              recommendedPrice === null ? "N/A" : formatCurrency(recommendedPrice)
            }
            detail={recommendationDetail}
          />
            <StatCard
              label="Lowest competitor price"
              value={formatCurrency(competitorQuoteSnapshot.summary.lowest)}
              detail={
                cheapestCompetitor
                  ? `${cheapestCompetitor.company} \u2022 ${cheapestCompetitor.vehicle}`
                  : elementsPrice !== null &&
                    elementsPrice !== undefined &&
                    !Number.isNaN(elementsPrice)
                  ? "No cheaper competitors"
                  : "No competitor rows for this filter set"
              }
              tone="canyon"
            />
          <StatCard
            label="Market Average"
            value={formatCurrency(competitorQuoteSnapshot.summary.average)}
            detail="Average competitor price for the current quote set"
          />
          <StatCard
            label="Highest competitor price"
            value={formatCurrency(competitorQuoteSnapshot.summary.highest)}
            detail={
              highestCompetitor
                ? `${highestCompetitor.company} \u2022 ${highestCompetitor.vehicle}`
                : `${formatCount(
                    competitorQuoteSnapshot.summary.competitorCount
                  )} quotes in current view`
            }
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
            <h2>{formatCurrency(dashboard.summary.lowest)} cheapest competitor</h2>
            <p>
              Current guidance lands at {formatCurrency(recommendedPrice)},{" "}
              {recommendationSource === "competitor"
                ? "anchored to the cheapest observed competitor for this selection."
                : recommendationSource === "elements"
                ? "using the Elements price fallback for this selection."
                : "awaiting a usable baseline for this selection."}
            </p>
          </article>

          <article className="insight-card">
            <span className="insight-card__label">Coverage</span>
            <h2>{dashboard.latestDateLabel}</h2>
            <p>
              Data is rolling up from pickup-date observations in{" "}
              {location || "both depots"}, with the latest viable competitor set used for
              the recommendation snapshot.
            </p>
          </article>
        </section>

        <section className="chart-grid">
          <article className="panel panel--wide">
            <div className="panel__header">
              <div>
                <span className="panel__eyebrow">Trend view</span>
                <h3>Price trend vs recommended guidance</h3>
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
                <PriceTrendChart data={dashboard.trend} />
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
                  {marketGap === null
                    ? "No matched Elements quote"
                    : marketGap >= 0
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
                  {cheapestCompetitor
                    ? `${cheapestCompetitor.company} ${cheapestCompetitor.vehicle} at ${formatCurrency(cheapestCompetitor.price)}`
                    : elementsPrice !== null &&
                      elementsPrice !== undefined &&
                      !Number.isNaN(elementsPrice)
                    ? "No cheaper competitors"
                    : "Awaiting competitor data"}
                </strong>
              </div>
              <div>
                <span>Highest signal</span>
                <strong>
                  {highestCompetitor
                    ? `${highestCompetitor.company} ${highestCompetitor.vehicle} at ${formatCurrency(highestCompetitor.price)}`
                    : "Awaiting competitor data"}
                </strong>
              </div>
              <div>
                <span>Recommendation</span>
                <strong>
                  {recommendedPrice === null ? "N/A" : formatCurrency(recommendedPrice)}
                </strong>
              </div>
            </div>
          </article>
        </section>

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
                  lowest={competitorQuoteSnapshot.summary.lowest}
                  highest={competitorQuoteSnapshot.summary.highest}
                  recommended={recommendedPrice}
                  elements={elementsPrice}
                  cheapestRow={competitorQuoteSnapshot.summary.cheapestRow}
                  highestRow={competitorQuoteSnapshot.summary.highestRow}
                />
              )}
            </div>
          </article>

          <article className="panel">
            <div className="panel__header">
              <div>
                <span className="panel__eyebrow">Operators</span>
                <h3>Competitor summary</h3>
              </div>
            </div>
            <div className="company-list">
              {competitorQuoteSnapshot.companyStats.length ? (
                competitorQuoteSnapshot.companyStats.map((company) => (
                  <div key={company.company} className="company-list__item">
                    <div>
                      <strong>{company.company}</strong>
                      <p>{company.vehicles}</p>
                    </div>
                    <div>
                      <strong>{formatCurrency(company.average)}</strong>
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
                </tr>
              </thead>
              <tbody>
                {quoteTableRows.length ? (
                  quoteTableRows.map((row) => (
                    <tr
                      key={`${row.company}-${row.normalizedVehicle}-${row.dateKey}-${row.dropoffDateKey}-${row.price}`}
                      style={
                        row.isElements
                          ? {
                              fontWeight: 700,
                              backgroundColor: "#f4efe2"
                            }
                          : undefined
                      }
                    >
                      <td>{row.isElements ? "Elements World" : row.company}</td>
                      <td>{row.vehicle}</td>
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
                          ? formatCurrency(row.dailyRate)
                          : "No data"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="7" className="table-empty">
                      No competitor quotes match the current selection.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;





