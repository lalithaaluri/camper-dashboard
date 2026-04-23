import { render, screen } from "@testing-library/react";
import App, {
  buildCompetitorQuoteSnapshot,
  buildExactTripMetrics,
  buildDashboardFromRows,
  buildQuoteTableRows,
  calculateRecommendedPrice,
  formatDiffVsElements,
  getMappedCompetitors,
  selectDefaultElementsRow,
  selectExactTripRow,
  selectLatestRowsBySnapshot
} from "./App";

jest.mock("@visx/responsive", () => ({
  ParentSize: ({ children }) => children({ width: 960, height: 400 })
}));

jest.mock("papaparse", () => ({
  parse: jest.fn((_, options) => {
    options.complete({
      data: [
        {
          pickup_date: "4/1/2026",
          pickup_date_parsed: "",
          dropoff_date: "4/2/2026",
          location: "auckland",
          company: "elementsworld",
          vehicle: "trekcampers",
          price: "320",
          scrape_date: "2026-04-17",
          type: "elements"
        },
        {
          pickup_date: "4/1/2026",
          pickup_date_parsed: "",
          dropoff_date: "4/2/2026",
          location: "auckland",
          company: "campervanvillage",
          vehicle: "aventus2",
          price: "280",
          scrape_date: "2026-04-17",
          type: "competitor"
        },
        {
          pickup_date: "4/1/2026",
          pickup_date_parsed: "",
          dropoff_date: "4/2/2026",
          location: "auckland",
          company: "campervanvillage",
          vehicle: "aventus2",
          price: "295",
          scrape_date: "2026-04-18",
          type: "competitor"
        },
        {
          pickup_date: "4/1/2026",
          pickup_date_parsed: "",
          dropoff_date: "4/5/2026",
          location: "auckland",
          company: "happycampers",
          vehicle: "sleeper",
          price: "700",
          scrape_date: "2026-04-17",
          type: "competitor"
        },
        {
          pickup_date: "4/1/2026",
          pickup_date_parsed: "",
          dropoff_date: "4/2/2026",
          location: "auckland",
          company: "elementsworld",
          vehicle: "trekmedium",
          price: "500",
          scrape_date: "2026-04-17",
          type: "elements"
        },
        {
          pickup_date: "4/2/2026",
          pickup_date_parsed: "",
          dropoff_date: "4/3/2026",
          location: "auckland",
          company: "elementsworld",
          vehicle: "trekcampers",
          price: "330",
          scrape_date: "2026-04-18",
          type: "elements"
        },
        {
          pickup_date: "4/2/2026",
          pickup_date_parsed: "",
          dropoff_date: "4/3/2026",
          location: "auckland",
          company: "campervanvillage",
          vehicle: "aventus2",
          price: "300",
          scrape_date: "2026-04-18",
          type: "competitor"
        }
      ]
    });
  })
}));

beforeEach(() => {
  global.fetch = jest.fn(async (input) => {
    const url = String(input);

    if (url.includes("/api/prices/latest")) {
      return {
        ok: true,
        json: async () => [
          {
            pickup_date: "2026-04-01",
            dropoff_date: "2026-04-02",
            location: "auckland",
            company: "elementsworld",
            vehicle: "trek large",
            price: 320,
            scrape_date: "2026-04-18",
            type: "elements"
          },
          {
            pickup_date: "2026-04-01",
            dropoff_date: "2026-04-02",
            location: "auckland",
            company: "campervanvillage",
            vehicle: "aventus2",
            price: 295,
            scrape_date: "2026-04-18",
            type: "competitor"
          }
        ]
      };
    }

    if (url.includes("/api/prices")) {
      return {
        ok: true,
        json: async () => [
          {
            pickup_date: "2026-04-01",
            dropoff_date: "2026-04-02",
            location: "auckland",
            company: "campervanvillage",
            vehicle: "aventus2",
            price: 295,
            scrape_date: "2026-04-18",
            type: "competitor"
          }
        ]
      };
    }

    if (url.includes("/api/health")) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          activeRunId: null,
          latestRun: null,
          dataset: {
            rowCount: 2,
            latestPickupDate: "2026-04-01",
            latestScrapeDate: "2026-04-18"
          }
        })
      };
    }

    return {
      ok: true,
      json: async () => ({})
    };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("renders camper revenue dashboard", async () => {
  render(<App />);

  expect(
    await screen.findByText(/modern pricing visibility for every road-trip class/i)
  ).toBeInTheDocument();
  expect(screen.getByText(/recommended rate/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /view latest data/i })).toHaveAttribute(
    "href",
    "http://localhost:4302/api/prices"
  );
  expect(screen.queryByText(/latest pickup date/i)).not.toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(
    "http://localhost:4302/api/prices/latest",
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );
  expect(global.fetch).toHaveBeenCalledWith(
    "http://localhost:4302/api/prices",
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );
});

test("selectDefaultElementsRow prefers the non-Trek Elements row with the strongest competitor coverage", () => {
  const rows = [
    {
      dateKey: "2026-04-01",
      dropoffDateKey: "2026-04-04",
      company: "elementsworld",
      vehicle: "trekcampers",
      price: 320
    },
    {
      dateKey: "2026-04-02",
      dropoffDateKey: "2026-04-06",
      company: "elementsworld",
      vehicle: "quad",
      price: 520
    },
    {
      dateKey: "2026-04-02",
      dropoffDateKey: "2026-04-06",
      company: "mighty",
      vehicle: "delite",
      price: 540
    },
    {
      dateKey: "2026-04-02",
      dropoffDateKey: "2026-04-06",
      company: "jucy",
      vehicle: "condo",
      price: 560
    },
    {
      dateKey: "2026-04-02",
      dropoffDateKey: "2026-04-06",
      company: "luckyrentals",
      vehicle: "rover",
      price: 580
    },
    {
      dateKey: "2026-04-01",
      dropoffDateKey: "2026-04-05",
      company: "elementsworld",
      vehicle: "tandem",
      price: 410
    },
    {
      dateKey: "2026-04-01",
      dropoffDateKey: "2026-04-05",
      company: "spaceships",
      vehicle: "beta2s",
      price: 350
    }
  ];

  expect(selectDefaultElementsRow(rows)).toMatchObject({
    vehicle: "quad",
    dateKey: "2026-04-02",
    dropoffDateKey: "2026-04-06"
  });
});

test("selectExactTripRow chooses the latest exact pickup and dropoff match", () => {
  const rows = [
    {
      dateKey: "2026-04-29",
      dropoffDateKey: "2026-05-05",
      location: "auckland",
      company: "elementsworld",
      vehicle: "trekcampers",
      price: 900,
      scrapeDate: new Date("2026-04-18")
    },
    {
      dateKey: "2026-04-29",
      dropoffDateKey: "2026-05-05",
      location: "auckland",
      company: "elementsworld",
      vehicle: "trekcampers",
      price: 930,
      scrapeDate: new Date("2026-04-19")
    },
    {
      dateKey: "2026-04-29",
      dropoffDateKey: "2026-05-05",
      location: "auckland",
      company: "campervanvillage",
      vehicle: "trekcampers",
      price: 880,
      scrapeDate: new Date("2026-04-19")
    }
  ];

  expect(
    selectExactTripRow({
      rows,
      selectedPickup: "2026-04-29",
      selectedDropoff: "2026-05-05",
      selectedVehicle: "trekcampers",
      selectedLocation: "auckland"
    })
  ).toMatchObject({
    company: "elementsworld",
    price: 930
  });
});

test("buildExactTripMetrics returns total price, duration, and daily rate only for an exact match", () => {
  const rows = [
    {
      dateKey: "2026-04-29",
      dropoffDateKey: "2026-05-05",
      location: "auckland",
      company: "elementsworld",
      vehicle: "trekcampers",
      price: 930,
      scrapeDate: new Date("2026-04-19")
    }
  ];

  expect(
    buildExactTripMetrics({
      rows,
      selectedPickup: "2026-04-29",
      selectedDropoff: "2026-05-05",
      selectedVehicle: "trekcampers",
      selectedLocation: "auckland"
    })
  ).toMatchObject({
    totalPrice: 930,
    duration: 6,
    dailyRate: 155,
    hasExactMatch: true
  });

  expect(
    buildExactTripMetrics({
      rows,
      selectedPickup: "2026-04-29",
      selectedDropoff: "2026-05-04",
      selectedVehicle: "trekcampers",
      selectedLocation: "auckland"
    })
  ).toMatchObject({
    totalPrice: null,
    dailyRate: null,
    hasExactMatch: false
  });
});

test("getMappedCompetitors returns the normalized competitor list for the selected vehicle", () => {
  expect(getMappedCompetitors("trek large")).toEqual([
    "campervanvillageaventus2"
  ]);
});

test("buildCompetitorQuoteSnapshot keeps only mapped competitor rows from the latest scrape and removes duplicates", () => {
  const rows = [
    {
      dateKey: "2026-05-27",
      dropoffDateKey: "2026-05-31",
      location: "auckland",
      company: "campervanvillage",
      vehicle: "Aventus 2",
      type: "competitor",
      price: 240,
      tripDays: 4,
      scrapeDate: new Date("2026-05-20")
    },
    {
      dateKey: "2026-05-27",
      dropoffDateKey: "2026-05-31",
      location: "auckland",
      company: "campervanvillage",
      vehicle: "aventus2",
      type: "competitor",
      price: 256,
      tripDays: 4,
      scrapeDate: new Date("2026-05-21")
    },
    {
      dateKey: "2026-05-27",
      dropoffDateKey: "2026-05-31",
      location: "auckland",
      company: "campervanvillage",
      vehicle: "aventus2",
      type: "competitor",
      price: 256,
      tripDays: 4,
      scrapeDate: new Date("2026-05-21")
    },
    {
      dateKey: "2026-05-27",
      dropoffDateKey: "2026-06-01",
      location: "auckland",
      company: "happycampers",
      vehicle: "Sleeper",
      type: "competitor",
      price: 320,
      tripDays: 5,
      scrapeDate: new Date("2026-05-21")
    },
    {
      dateKey: "2026-05-27",
      dropoffDateKey: "2026-05-31",
      location: "christchurch",
      company: "happycampers",
      vehicle: "Sleeper",
      type: "competitor",
      price: 280,
      tripDays: 4,
      scrapeDate: new Date("2026-05-21")
    },
    {
      dateKey: "2026-05-27",
      dropoffDateKey: "2026-05-31",
      location: "auckland",
      company: "elementsworld",
      vehicle: "trek large",
      type: "elements",
      price: 500,
      tripDays: 4,
      scrapeDate: new Date("2026-05-21")
    }
  ];

  const snapshot = buildCompetitorQuoteSnapshot({
    rows,
    selectedPickup: "2026-05-27",
    selectedDropoff: "2026-05-31",
    selectedVehicle: "trek large",
    selectedLocation: "auckland"
  });

  expect(snapshot.rows).toHaveLength(1);
  expect(snapshot.rows.map((row) => row.price)).toEqual([256]);
  expect(snapshot.rows[0]).toMatchObject({
    company: "campervanvillage",
    vehicle: "aventus2",
    durationDays: 4,
    dailyRate: 64
  });
  expect(snapshot.summary).toMatchObject({
    lowest: 256,
    highest: 256,
    average: 256,
    competitorCount: 1
  });
});

test("buildQuoteTableRows places Elements first and keeps competitors sorted by price", () => {
  const rows = buildQuoteTableRows({
    elementsRow: {
      company: "elementsworld",
      vehicle: "trekcampers",
      dateKey: "2026-06-04",
      dropoffDateKey: "2026-06-18",
      price: 551,
      tripDays: 14
    },
    competitorRows: [
      {
        company: "happycampers",
        vehicle: "sleeper",
        normalizedVehicle: "sleeper",
        dateKey: "2026-06-04",
        dropoffDateKey: "2026-06-18",
        price: 949,
        durationDays: 14,
        dailyRate: 68,
        isElements: false
      },
      {
        company: "campervanvillage",
        vehicle: "aventus2",
        normalizedVehicle: "aventus2",
        dateKey: "2026-06-04",
        dropoffDateKey: "2026-06-18",
        price: 447,
        durationDays: 14,
        dailyRate: 32,
        isElements: false
      },
      {
        company: "roadrunner",
        vehicle: "stationwagen",
        normalizedVehicle: "stationwagen",
        dateKey: "2026-06-04",
        dropoffDateKey: "2026-06-18",
        price: 546,
        durationDays: 14,
        dailyRate: 39,
        isElements: false
      }
    ]
  });

  expect(rows.map((row) => [row.isElements, row.price])).toEqual([
    [true, 551],
    [false, 447],
    [false, 546],
    [false, 949]
  ]);
  expect(rows[0]).toMatchObject({
    company: "elementsworld",
    durationDays: 14,
    dailyRate: 39
  });
  expect(rows[1].durationDays).toBe(14);
});

test("calculateRecommendedPrice returns a total even when duration is unavailable", () => {
  const recommended = calculateRecommendedPrice(447, 14, 5);

  expect(recommended.baselinePrice).toBe(447);
  expect(recommended.recommendedDailyRate).toBeCloseTo(33.525, 3);
  expect(recommended.recommendedTotalPrice).toBeCloseTo(469.35, 2);
  expect(calculateRecommendedPrice(447, 0, 5)).toMatchObject({
    baselinePrice: 447,
    recommendedDailyRate: null,
    recommendedTotalPrice: 469.35
  });
});

test("selectLatestRowsBySnapshot keeps the most recent scrape for each market slot", () => {
  const rows = [
    {
      dateKey: "2026-04-01",
      dropoffDate: "4/2/2026",
      location: "auckland",
      company: "campervanvillage",
      vehicle: "aventus2",
      type: "competitor",
      price: 280,
      tripDays: 1,
      scrapeDate: new Date("2026-04-17")
    },
    {
      dateKey: "2026-04-01",
      dropoffDate: "4/2/2026",
      location: "auckland",
      company: "campervanvillage",
      vehicle: "aventus2",
      type: "competitor",
      price: 295,
      tripDays: 1,
      scrapeDate: new Date("2026-04-18")
    },
    {
      dateKey: "2026-04-01",
      dropoffDate: "4/5/2026",
      location: "auckland",
      company: "happycampers",
      vehicle: "sleeper",
      type: "competitor",
      price: 700,
      tripDays: 4,
      scrapeDate: new Date("2026-04-17")
    }
  ];

  expect(selectLatestRowsBySnapshot(rows)).toEqual([
    rows[1],
    rows[2]
  ]);
});

test("buildDashboardFromRows uses the latest pickup date by default and filters to a selected date", () => {
  const config = {
    competitorVehicles: ["aventus2"],
    elementsVehicles: ["trekcampers"]
  };
  const rows = [
    {
      dateKey: "2026-04-01",
      dropoffDate: "4/2/2026",
      location: "auckland",
      company: "elementsworld",
      vehicle: "trekcampers",
      type: "elements",
      price: 320,
      tripDays: 1,
      scrapeDate: new Date("2026-04-17")
    },
    {
      dateKey: "2026-04-01",
      dropoffDate: "4/2/2026",
      location: "auckland",
      company: "campervanvillage",
      vehicle: "aventus2",
      type: "competitor",
      price: 295,
      tripDays: 1,
      scrapeDate: new Date("2026-04-18")
    },
    {
      dateKey: "2026-04-02",
      dropoffDate: "4/3/2026",
      location: "auckland",
      company: "elementsworld",
      vehicle: "trekcampers",
      type: "elements",
      price: 330,
      tripDays: 1,
      scrapeDate: new Date("2026-04-18")
    },
    {
      dateKey: "2026-04-02",
      dropoffDate: "4/3/2026",
      location: "auckland",
      company: "campervanvillage",
      vehicle: "aventus2",
      type: "competitor",
      price: 300,
      tripDays: 1,
      scrapeDate: new Date("2026-04-18")
    }
  ];

  const defaultDashboard = buildDashboardFromRows({
    rows,
    config,
    adjustment: 5
  });
  const filteredDashboard = buildDashboardFromRows({
    rows,
    config,
    adjustment: 5,
    selectedDate: "2026-04-02"
  });

  expect(defaultDashboard.latestRows.map((row) => row.dateKey)).toEqual([
    "2026-04-02"
  ]);
  expect(defaultDashboard.summary.average).toBe(300);
  expect(defaultDashboard.summary.elements).toBe(330);
  expect(defaultDashboard.summary.recommended).toBe(315);
  expect(defaultDashboard.summary.cheapestRow).toMatchObject({
    company: "campervanvillage",
    vehicle: "aventus2",
    price: 300
  });
  expect(defaultDashboard.summary.highestRow).toMatchObject({
    company: "campervanvillage",
    vehicle: "aventus2",
    price: 300
  });
  expect(defaultDashboard.trend[1]).toMatchObject({
    lowest: 300,
    highest: 300,
    cheapestRow: {
      company: "campervanvillage",
      vehicle: "aventus2",
      price: 300,
      dateKey: "2026-04-02",
      dropoffDate: "4/3/2026",
      location: "auckland",
      type: "competitor",
      tripDays: 1,
      scrapeDate: new Date("2026-04-18")
    },
    highestRow: {
      company: "campervanvillage",
      vehicle: "aventus2",
      price: 300,
      dateKey: "2026-04-02",
      dropoffDate: "4/3/2026",
      location: "auckland",
      type: "competitor",
      tripDays: 1,
      scrapeDate: new Date("2026-04-18")
    },
    elements: 330,
    recommended: 315
  });
  expect(defaultDashboard.latestDateLabel).toMatch(/02\/04\/2026/i);
  expect(filteredDashboard.latestRows.map((row) => row.dateKey)).toEqual([
    "2026-04-02"
  ]);
  expect(filteredDashboard.latestDateLabel).toMatch(/02\/04\/2026/i);
});

test("buildDashboardFromRows falls back to available rows when latest date has no matched snapshot", () => {
  const config = {
    competitorVehicles: ["aventus2"],
    elementsVehicles: ["trekcampers"]
  };
  const rows = [
    {
      dateKey: "2026-04-01",
      dropoffDate: "4/2/2026",
      location: "auckland",
      company: "elementsworld",
      vehicle: "trekcampers",
      type: "elements",
      price: 320,
      tripDays: 1,
      scrapeDate: new Date("2026-04-17")
    },
    {
      dateKey: "2026-04-01",
      dropoffDate: "4/2/2026",
      location: "auckland",
      company: "campervanvillage",
      vehicle: "aventus2",
      type: "competitor",
      price: 295,
      tripDays: 1,
      scrapeDate: new Date("2026-04-18")
    },
    {
      dateKey: "2026-04-02",
      dropoffDate: "4/5/2026",
      location: "auckland",
      company: "elementsworld",
      vehicle: "trekcampers",
      type: "elements",
      price: 330,
      tripDays: 3,
      scrapeDate: new Date("2026-04-18")
    }
  ];

  const dashboard = buildDashboardFromRows({
    rows,
    config,
    adjustment: 5
  });

  expect(dashboard.latestRows.map((row) => row.dateKey)).toEqual([
    "2026-04-01"
  ]);
  expect(dashboard.summary.average).toBe(295);
  expect(dashboard.summary.recommended).toBe(310);
});

test("buildDashboardFromRows bases recommendation on cheapest competitor and margin", () => {
  const config = {
    competitorVehicles: ["aventus2", "sleeper"],
    elementsVehicles: ["trekcampers"]
  };
  const rows = [
    {
      dateKey: "2026-04-02",
      dropoffDate: "4/3/2026",
      location: "auckland",
      company: "elementsworld",
      vehicle: "trekcampers",
      type: "elements",
      price: 330,
      tripDays: 1,
      scrapeDate: new Date("2026-04-18")
    },
    {
      dateKey: "2026-04-02",
      dropoffDate: "4/3/2026",
      location: "auckland",
      company: "campervanvillage",
      vehicle: "aventus2",
      type: "competitor",
      price: 220,
      tripDays: 1,
      scrapeDate: new Date("2026-04-18")
    },
    {
      dateKey: "2026-04-02",
      dropoffDate: "4/3/2026",
      location: "auckland",
      company: "happycampers",
      vehicle: "sleeper",
      type: "competitor",
      price: 260,
      tripDays: 1,
      scrapeDate: new Date("2026-04-18")
    }
  ];

  const dashboard = buildDashboardFromRows({
    rows,
    config,
    adjustment: -5
  });

  expect(dashboard.summary.lowest).toBe(220);
  expect(dashboard.summary.average).toBe(240);
  expect(dashboard.summary.recommended).toBe(209);
  expect(dashboard.summary.recommended).toBeLessThan(dashboard.summary.average);
});

test("buildDashboardFromRows still anchors recommendation to cheapest competitor when Elements is cheaper", () => {
  const config = {
    competitorVehicles: ["aventus2", "sleeper"],
    elementsVehicles: ["tandem"]
  };
  const rows = [
    {
      dateKey: "2026-04-02",
      dropoffDate: "2026-04-05",
      location: "auckland",
      company: "elementsworld",
      vehicle: "tandem",
      type: "elements",
      price: 180,
      tripDays: 3,
      scrapeDate: new Date("2026-04-18")
    },
    {
      dateKey: "2026-04-02",
      dropoffDate: "2026-04-05",
      location: "auckland",
      company: "campervanvillage",
      vehicle: "aventus2",
      type: "competitor",
      price: 220,
      tripDays: 3,
      scrapeDate: new Date("2026-04-18")
    }
  ];

  const dashboard = buildDashboardFromRows({
    rows,
    config,
    adjustment: 10
  });

  expect(dashboard.summary.lowest).toBe(220);
  expect(dashboard.summary.elements).toBe(180);
  expect(dashboard.summary.recommended).toBe(242);
  expect(dashboard.summary.recommendationSource).toBe("competitor");
});

test("buildDashboardFromRows falls back to Elements pricing when competitor data is unavailable", () => {
  const config = {
    competitorVehicles: ["beta2s"],
    elementsVehicles: ["tandem"]
  };
  const rows = [
    {
      dateKey: "2026-04-02",
      dropoffDate: "2026-04-05",
      location: "auckland",
      company: "elementsworld",
      vehicle: "tandem",
      type: "elements",
      price: 300,
      tripDays: 3,
      scrapeDate: new Date("2026-04-18")
    }
  ];

  const dashboard = buildDashboardFromRows({
    rows,
    config,
    adjustment: 10
  });

  expect(dashboard.summary.lowest).toBeNull();
  expect(dashboard.summary.elements).toBe(300);
  expect(dashboard.summary.recommended).toBe(330);
  expect(dashboard.summary.recommendationSource).toBe("elements");
});

test("formatDiffVsElements returns business-friendly labels", () => {
  expect(formatDiffVsElements(25)).toBe("+$25 (More expensive)");
  expect(formatDiffVsElements(-25)).toBe("-$25 (Cheaper)");
  expect(formatDiffVsElements(0)).toBe("$0 (Same price)");
});
