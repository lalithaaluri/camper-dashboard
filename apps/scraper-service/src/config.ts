import type { DepotCode, PriceRow } from "./types.js";

export const BASE_URL = "https://www.australianbackpackers.net";

export const DEPOTS: Record<DepotCode, { label: string }> = {
  auckland: { label: "Auckland" },
  christchurch: { label: "Christchurch" }
};

type VehicleRule = {
  company: PriceRow["company"];
  vehicle: PriceRow["vehicle"];
  type: PriceRow["type"];
  matchAll: string[];
};

const vehicleRules: VehicleRule[] = [
  {
    company: "happycampers",
    vehicle: "sleeper",
    type: "competitor",
    matchAll: ["happy", "sleeper"]
  },
  {
    company: "luckyrentals",
    vehicle: "rover",
    type: "competitor",
    matchAll: ["lucky", "rover"]
  },
  {
    company: "jucy",
    vehicle: "condo",
    type: "competitor",
    matchAll: ["jucy", "condo"]
  },
  {
    company: "jucy",
    vehicle: "crib",
    type: "competitor",
    matchAll: ["jucy", "crib"]
  },
  {
    company: "spaceships",
    vehicle: "beta2s",
    type: "competitor",
    matchAll: ["beta", "2s"]
  },
  {
    company: "mighty",
    vehicle: "doubledown",
    type: "competitor",
    matchAll: ["double", "down"]
  },
  {
    company: "mighty",
    vehicle: "doubleup",
    type: "competitor",
    matchAll: ["double", "up"]
  },
  {
    company: "mighty",
    vehicle: "highball",
    type: "competitor",
    matchAll: ["highball"]
  },
  {
    company: "mighty",
    vehicle: "bigsix",
    type: "competitor",
    matchAll: ["big", "six"]
  },
  {
    company: "mighty",
    vehicle: "deuce",
    type: "competitor",
    matchAll: ["deuce"]
  },
  {
    company: "mighty",
    vehicle: "delite",
    type: "competitor",
    matchAll: ["delite"]
  },
  {
    company: "travellersautobarn",
    vehicle: "stationwagen",
    type: "competitor",
    matchAll: ["station", "wagon"]
  },
  {
    company: "campervanvillage",
    vehicle: "freedom",
    type: "competitor",
    matchAll: ["freedom"]
  },
  {
    company: "campervanvillage",
    vehicle: "aventus2",
    type: "competitor",
    matchAll: ["aventus"]
  },
  {
    company: "campervanvillage",
    vehicle: "aventus2",
    type: "competitor",
    matchAll: ["aventus", "plus"]
  },
  {
    company: "elementsworld",
    vehicle: "tandemdeluxe",
    type: "elements",
    matchAll: ["tandem", "deluxe"]
  },
  {
    company: "elementsworld",
    vehicle: "tandem",
    type: "elements",
    matchAll: ["tandem"]
  },
  {
    company: "elementsworld",
    vehicle: "quad",
    type: "elements",
    matchAll: ["quad"]
  },
  {
    company: "elementsworld",
    vehicle: "sixer",
    type: "elements",
    matchAll: ["sixer"]
  },
  {
    company: "elementsworld",
    vehicle: "sixer",
    type: "elements",
    matchAll: ["6", "berth"]
  },
  {
    company: "elementsworld",
    vehicle: "trek large",
    type: "elements",
    matchAll: ["trek", "large"]
  },
  {
    company: "elementsworld",
    vehicle: "trek medium",
    type: "elements",
    matchAll: ["trek", "medium"]
  },
  {
    company: "elementsworld",
    vehicle: "trek budget",
    type: "elements",
    matchAll: ["trek", "budget"]
  }
];

export const normalizeText = (value: string) =>
  value.toLowerCase().replace(/\s+/g, " ").trim();

export const identifyVehicle = (text: string) => {
  const haystack = normalizeText(text);

  for (const rule of vehicleRules) {
    if (rule.matchAll.every((fragment) => haystack.includes(fragment))) {
      return {
        company: rule.company,
        vehicle: rule.vehicle,
        type: rule.type
      };
    }
  }

  return null;
};

export const generateDropoffDates = (pickupDate: string, maxTripDays: number) => {
  const [year, month, day] = pickupDate.split("-").map((part) => Number(part));
  const pickup = new Date(Date.UTC(year, month - 1, day));

  if (!year || !month || !day || Number.isNaN(pickup.getTime())) {
    throw new Error(`Invalid pickup date: ${pickupDate}`);
  }

  const dates: Array<{ pickupDate: string; dropoffDate: string }> = [];

  for (let offset = 1; offset <= maxTripDays; offset += 1) {
    const dropoff = new Date(pickup);
    dropoff.setUTCDate(dropoff.getUTCDate() + offset);

    if (dropoff.getUTCMonth() !== pickup.getUTCMonth()) {
      break;
    }

    dates.push({
      pickupDate,
      dropoffDate: dropoff.toISOString().slice(0, 10)
    });
  }

  return dates;
};
