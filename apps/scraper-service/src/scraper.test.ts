import test from "node:test";
import assert from "node:assert/strict";
import { generateDropoffDates, identifyVehicle } from "./config.js";
import { generateMultiMonthMatrix } from "./scraper.js";

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

test("generateMultiMonthMatrix with 2 pickup days expands pickup+dropoff combinations", () => {
  const dates = generateMultiMonthMatrix("2026-04-01", 2);
  assert.equal(dates.length, 57);
  assert.deepEqual(dates[0], {
    pickupDate: "2026-04-01",
    dropoffDate: "2026-04-02"
  });
  assert.deepEqual(dates[dates.length - 1], {
    pickupDate: "2026-04-02",
    dropoffDate: "2026-04-30"
  });
});

test("generateMultiMonthMatrix with 30 trip days covers full April", () => {
  const dates = generateMultiMonthMatrix("2026-04-01", 30);
  assert.equal(dates.length, 435);
  assert.deepEqual(dates[0], {
    pickupDate: "2026-04-01",
    dropoffDate: "2026-04-02"
  });
  assert.deepEqual(dates[dates.length - 1], {
    pickupDate: "2026-04-29",
    dropoffDate: "2026-04-30"
  });
});

test("generateMultiMonthMatrix with 60 pickup days still stops pickup expansion at month boundary", () => {
  const dates = generateMultiMonthMatrix("2026-04-01", 60);
  assert.equal(dates.length, 435);

  assert.deepEqual(dates[0], {
    pickupDate: "2026-04-01",
    dropoffDate: "2026-04-02"
  });
  assert.deepEqual(dates[dates.length - 1], {
    pickupDate: "2026-04-29",
    dropoffDate: "2026-04-30"
  });

  assert.equal(
    dates.some((pair) => pair.pickupDate.slice(0, 7) !== pair.dropoffDate.slice(0, 7)),
    false
  );
});
