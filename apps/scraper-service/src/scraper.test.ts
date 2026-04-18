import test from "node:test";
import assert from "node:assert/strict";
import { generateDropoffDates, identifyVehicle } from "./config.js";

test("generateDropoffDates stops at the end of the month", () => {
  const dates = generateDropoffDates("2026-04-28", 30);
  assert.deepEqual(dates, [
    {
      pickupDate: "2026-04-28",
      dropoffDate: "2026-04-29"
    },
    {
      pickupDate: "2026-04-28",
      dropoffDate: "2026-04-30"
    }
  ]);
});

test("identifyVehicle maps legacy text to normalized dashboard keys", () => {
  assert.deepEqual(
    identifyVehicle("Elements World Tandem Deluxe Automatic Camper"),
    {
      company: "elementsworld",
      vehicle: "tandemdeluxe",
      type: "elements"
    }
  );

  assert.deepEqual(
    identifyVehicle("Lucky Rentals Rover sleeper van special price"),
    {
      company: "luckyrentals",
      vehicle: "rover",
      type: "competitor"
    }
  );
});
