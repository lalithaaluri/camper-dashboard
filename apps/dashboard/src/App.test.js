import { render, screen } from "@testing-library/react";
import App from "./App";

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
