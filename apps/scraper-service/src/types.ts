export type DepotCode = "auckland" | "christchurch";

export type RunStatus = "queued" | "running" | "completed" | "failed";

export interface ScrapeRequest {
  pickupDate: string;
  locations: DepotCode[];
  maxTripDays: number;
  headless: boolean;
}

export interface PriceRow {
  pickup_date: string;
  dropoff_date: string;
  location: DepotCode;
  company: string;
  vehicle: string;
  price: number;
  scrape_date: string;
  type: "elements" | "competitor";
}

export interface RunSummary {
  id: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  pickupDate: string;
  locations: DepotCode[];
  maxTripDays: number;
  headless: boolean;
  rowsCaptured: number;
  rowsProcessed: number;
  rowsInserted: number;
  totalRows: number;
  datesVisited: number;
  error?: string;
  artifacts?: {
    csvPath?: string;
    logPath?: string;
  };
}

export interface ScrapeRunResult {
  rows: PriceRow[];
  rowsProcessed: number;
  datesVisited: number;
  warnings: string[];
}

export interface DatasetSummary {
  rowCount: number;
  locations: DepotCode[];
  latestPickupDate: string | null;
  latestScrapeDate: string | null;
}
