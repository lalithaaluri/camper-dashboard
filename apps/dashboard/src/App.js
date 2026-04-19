import { useEffect, useState } from "react";
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
  trekcampers: {
    label: "Trek Campers",
    shortLabel: "Trek",
    competitorVehicles: ["stationwagen", "sleeper", "aventus2"],
    elementsVehicles: ["trekcampers"],
    narrative: "Entry-level two-berth trips and budget-led weekend demand."
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
    lowest: 0,
    average: 0,
    highest: 0,
    cheapestRow: null,
    highestRow: null,
    elements: null,
    recommended: 0,
    spread: 0,
    upliftValue: 0,
    upliftPercent: 0,
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

const normalize = (value) => (value ? value.toLowerCase().trim() : "");

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


const collectBucketMetrics = (bucket) => {
  const elementsRows = bucket?.elementsRows || [];
  const validDurations = new Set(
    elementsRows
      .map((row) => row.tripDays)
      .filter((tripDays) => tripDays !== null && tripDays !== undefined)
  );
  const competitorRows =
    bucket?.competitorCandidates.filter((row) => validDurations.has(row.tripDays)) || [];
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

const calculateRecommendedPrice = (lowest, average, adjustment) => {
  if (lowest === null || lowest === undefined || Number.isNaN(lowest)) {
    return 0;
  }

  const candidate = lowest * (1 + adjustment / 100);

  if (average === null || average === undefined || Number.isNaN(average)) {
    return candidate;
  }

  return Math.min(candidate, average);
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

const groupRelevantRows = (rows, config) => {
  const grouped = new Map();

  rows.forEach((row) => {
    const isElementsRow =
      row.company === "elementsworld" && config.elementsVehicles.includes(row.vehicle);
    const isCompetitorRow =
      row.company !== "elementsworld" && config.competitorVehicles.includes(row.vehicle);

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

export const buildDashboardFromRows = ({
  rows,
  config,
  adjustment,
  selectedDate = ""
}) => {
  if (!rows.length) {
    return initialDashboard;
  }

  const grouped = groupRelevantRows(rows, config);

  const sortedDates = Array.from(grouped.keys()).sort();
  const trend = sortedDates.map((dateKey) => {
    const bucketMetrics = collectBucketMetrics(grouped.get(dateKey));

    return {
      dateKey,
      lowest: bucketMetrics.lowest,
      highest: bucketMetrics.highest,
      cheapestRow: bucketMetrics.cheapestRow,
      highestRow: bucketMetrics.highestRow,
      elements: bucketMetrics.elements,
      recommended:
        bucketMetrics.lowest === null
          ? null
          : calculateRecommendedPrice(
              bucketMetrics.lowest,
              bucketMetrics.average,
              adjustment
            ),
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
  const latestAverage = competitorPrices.length ? averageFrom(competitorPrices) : 0;
  const latestElements = snapshotMetrics?.elementsPrices?.length
    ? averageFrom(snapshotMetrics.elementsPrices)
    : null;
  const cheapestRow = latestRows.length
    ? latestRows.reduce((min, row) => (row.price < min.price ? row : min))
    : null;
  const highestRow = latestRows.length
    ? latestRows.reduce((max, row) => (row.price > max.price ? row : max))
    : null;
  const lowest = cheapestRow ? cheapestRow.price : 0;
  const highest = highestRow ? highestRow.price : 0;
  const recommended = competitorPrices.length
    ? calculateRecommendedPrice(lowest, latestAverage, adjustment)
    : 0;
  const spread = highest - lowest;
  const upliftValue = recommended - lowest;
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
      competitorCount: latestRows.length,
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
  const [vehicle, setVehicle] = useState("trekcampers");
  const [adjustment, setAdjustment] = useState(5);
  const [location, setLocation] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [datasetVersion, setDatasetVersion] = useState(0);
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

  useEffect(() => {
    setLoading(true);
    Papa.parse("/dataset_FINAL_SAFE.csv", {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const cleanedRows = result.data
          .map((row) => {
            const dateObject = parseDate(row.pickup_date_parsed || row.pickup_date);
            const dropoffObject = parseDate(row.dropoff_date);
            const dateKey = dateObject ? dateObject.toISOString().split("T")[0] : "";
            const price = Number(row.price);

            return {
              dateKey,
              dropoffDate: row.dropoff_date ? String(row.dropoff_date).trim() : "",
              company: normalize(row.company),
              vehicle: normalize(row.vehicle),
              location: normalize(row.location),
              type: normalize(row.type),
              price,
              tripDays: calculateTripDays(dateObject, dropoffObject),
              scrapeDate: parseDate(row.scrape_date)
            };
          })
          .filter(
            (row) =>
              row.dateKey &&
              row.company &&
              row.vehicle &&
              row.location &&
              Number.isFinite(row.price)
          );

        setRows(cleanedRows);
        setLoading(false);
      },
      error: () => {
        setRows([]);
        setLoading(false);
      }
    });
  }, [datasetVersion]);

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
    const relevantRows = [];

    rows.forEach((row) => {
      if (location && row.location !== location) {
        return;
      }

      relevantRows.push(row);
    });

    setDashboard(
      buildDashboardFromRows({
        rows: selectLatestRowsBySnapshot(relevantRows),
        config,
        adjustment,
        selectedDate
      })
    );
  }, [adjustment, location, rows, selectedDate, vehicle]);

  const activeConfig = vehicleConfigs[vehicle];
  const marketGap =
    dashboard.summary.elements !== null
      ? dashboard.summary.elements - dashboard.summary.average
      : null;
  const cheapestCompetitor = dashboard.summary.cheapestRow;
  const highestCompetitor = dashboard.summary.highestRow;
  const latestRun = scraperStatus.latestRun;

  const toggleScrapeLocation = (nextLocation) => {
    setScrapeLocations((current) =>
      current.includes(nextLocation)
        ? current.filter((entry) => entry !== nextLocation)
        : [...current, nextLocation]
    );
  };

  const refreshDataset = () => {
    setDatasetVersion((current) => current + 1);
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
                <span className="hero-metadata__label">Latest Pickup Date</span>
                <strong>{dashboard.latestDateLabel}</strong>
              </div>
              <div>
                <span className="hero-metadata__label">Market focus</span>
                <strong>{location || "All depots"}</strong>
              </div>
            </div>
          </div>

          <aside className="hero-highlight">
            <p className="hero-highlight__label">Pricing posture</p>
            <strong>{formatCurrency(dashboard.summary.recommended)}</strong>
            <p className="hero-highlight__detail">
              Suggested rate based on current competitor average plus a{" "}
              {dashboard.summary.upliftPercent}% margin buffer.
            </p>
            <div className="hero-highlight__meter">
              <span>Market avg</span>
              <div className="hero-highlight__rail">
                <div
                  className="hero-highlight__fill"
                  style={{
                    width: `${Math.min(
                      100,
                      dashboard.summary.average
                        ? (dashboard.summary.recommended / dashboard.summary.average) * 65
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
              <input
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
              />
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
                <a href={`${SCRAPER_API_BASE}/data/dataset_FINAL_SAFE.csv`} target="_blank" rel="noreferrer">
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

        <section className="stats-grid">
          <StatCard
            label="Recommended rate"
            value={formatCurrency(dashboard.summary.recommended)}
            detail={`${formatCurrency(dashboard.summary.upliftValue)} above market average`}
            tone="forest"
          />
          <StatCard
            label="Elements latest"
            value={formatCurrency(dashboard.summary.elements)}
            detail={
              marketGap === null
                ? "Waiting for a matched Elements quote"
                : `${marketGap >= 0 ? "+" : ""}${formatCurrency(marketGap)} vs market`
            }
            tone="sand"
          />
          <StatCard
            label="Cheapest competitor"
            value={formatCurrency(dashboard.summary.lowest)}
            detail={
              cheapestCompetitor
                ? `${cheapestCompetitor.company} • ${cheapestCompetitor.vehicle}`
                : "No competitor rows for this filter set"
            }
            tone="canyon"
          />
          <StatCard
            label="Market spread"
            value={formatCurrency(dashboard.summary.spread)}
            detail={
              highestCompetitor
                ? `${highestCompetitor.company} • ${highestCompetitor.vehicle}`
                : `${formatCount(dashboard.summary.competitorCount)} quotes in current view`
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
            <h2>{formatCurrency(dashboard.summary.average)} market centre</h2>
            <p>
              Current guidance lands at {formatCurrency(dashboard.summary.recommended)},
              giving commercial room while staying anchored to observed competitor pricing.
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
                <div className="chart-empty">Loading market historyâ€¦</div>
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
                <strong>{formatCurrency(dashboard.summary.recommended)}</strong>
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
                <div className="chart-empty">Loading competitor mixâ€¦</div>
              ) : (
                <MarketSpreadChart
                  lowest={dashboard.summary.lowest}
                  highest={dashboard.summary.highest}
                  recommended={dashboard.summary.recommended}
                  elements={dashboard.summary.elements}
                  cheapestRow={dashboard.summary.cheapestRow}
                  highestRow={dashboard.summary.highestRow}
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
              {dashboard.companyStats.length ? (
                dashboard.companyStats.map((company) => (
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
                  <th>Location</th>
                  <th>Pickup</th>
                  <th>Price</th>
                  <th>Diff vs Elements</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.latestRows.length ? (
                  dashboard.latestRows.map((row, index) => (
                    <tr key={`${row.company}-${row.vehicle}-${index}`}>
                      <td>{row.company}</td>
                      <td>{row.vehicle}</td>
                      <td>{row.location}</td>
                      <td>{formatDateLabel(row.dateKey, { year: "numeric" })}</td>
                      <td>{formatCurrency(row.price)}</td>
                      <td>
                        {dashboard.summary.elements !== null
                          ? formatDiffVsElements(row.price - dashboard.summary.elements)
                          : "No data"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="6" className="table-empty">
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





