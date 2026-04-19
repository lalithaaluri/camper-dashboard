import { render, screen } from "@testing-library/react";
import App, {
  buildDashboardFromRows,
  formatDiffVsElements,
  selectLatestRowsBySnapshot
} from "./App";

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

test("renders camper revenue dashboard", async () => {
  render(<App />);

  expect(
    await screen.findByText(/modern pricing visibility for every road-trip class/i)
  ).toBeInTheDocument();
  expect(screen.getByText(/recommended rate/i)).toBeInTheDocument();
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
  expect(defaultDashboard.summary.recommended).toBe(300);
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
    recommended: 300
  });
  expect(defaultDashboard.latestDateLabel).toMatch(/2 Apr 2026/i);
  expect(filteredDashboard.latestRows.map((row) => row.dateKey)).toEqual([
    "2026-04-02"
  ]);
  expect(filteredDashboard.latestDateLabel).toMatch(/2 Apr 2026/i);
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
  expect(dashboard.summary.recommended).toBe(295);
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

test("formatDiffVsElements returns business-friendly labels", () => {
  expect(formatDiffVsElements(25)).toBe("+$25 (More expensive)");
  expect(formatDiffVsElements(-25)).toBe("-$25 (Cheaper)");
  expect(formatDiffVsElements(0)).toBe("$0 (Same price)");
});
