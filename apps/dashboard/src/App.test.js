import { render, screen } from "@testing-library/react";
import App, { selectLatestRowsBySnapshot } from "./App";

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
