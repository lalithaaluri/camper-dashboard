import { writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import { BASE_URL, DEPOTS, generateDropoffDates, identifyVehicle } from "./config.js";
import { paths } from "./storage.js";
import type { DepotCode, PriceRow, ScrapeRequest, ScrapeRunResult } from "./types.js";

const SEARCH_TIMEOUT_MS = 20_000;
const RESULTS_TIMEOUT_MS = 30_000;

const cleanPrice = (value: string) => {
  const numeric = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isVisible = async (locator: Locator) => {
  if ((await locator.count()) === 0) {
    return false;
  }

  try {
    return await locator.first().isVisible();
  } catch {
    return false;
  }
};

const tryFill = async (locator: Locator, value: string) => {
  if (!(await isVisible(locator))) {
    return false;
  }

  const field = locator.first();

  try {
    const tagName = await field.evaluate((node) => node.tagName.toLowerCase());
    if (tagName === "select") {
      await field.selectOption({ label: value }).catch(async () => field.selectOption(value));
    } else {
      await field.fill("");
      await field.fill(value);
    }
    return true;
  } catch {
    return false;
  }
};

const fillLocationField = async (page: Page, depot: DepotCode) => {
  const label = DEPOTS[depot].label;
  const candidates = [
    page.getByLabel(/pick\s*up\s*location/i),
    page.getByLabel(/location/i),
    page.locator("select[name*='location']"),
    page.locator("input[name*='location']"),
    page.locator("select"),
    page.locator("input[placeholder*='Location' i]")
  ];

  for (const candidate of candidates) {
    if (await tryFill(candidate, label)) {
      return true;
    }
  }

  return false;
};

const fillDateField = async (page: Page, value: string, kind: "pickup" | "dropoff") => {
  const regex = kind === "pickup" ? /pick\s*up/i : /drop\s*off/i;
  const candidates = [
    page.getByLabel(regex),
    page.locator(`input[name*='${kind === "pickup" ? "pick" : "drop"}']`),
    page.locator(`input[id*='${kind === "pickup" ? "pick" : "drop"}']`),
    page.locator(`input[placeholder*='${kind === "pickup" ? "Pick" : "Drop"}' i]`),
    page.locator("input[type='date']")
  ];

  for (const candidate of candidates) {
    if (await tryFill(candidate, value)) {
      return true;
    }
  }

  return false;
};

const submitSearch = async (page: Page) => {
  const buttons = [
    page.getByRole("button", { name: /search|find|quote/i }),
    page.locator("button[type='submit']"),
    page.locator("input[type='submit']"),
    page.locator("form button")
  ];

  for (const button of buttons) {
    if (!(await isVisible(button))) {
      continue;
    }

    try {
      await button.first().click();
      return true;
    } catch {
      continue;
    }
  }

  return false;
};

const dismissOverlays = async (page: Page) => {
  const buttons = [
    page.getByRole("button", { name: /accept|agree|close|dismiss/i }),
    page.locator("[aria-label='Close']"),
    page.locator(".cky-btn-accept")
  ];

  for (const button of buttons) {
    if (await isVisible(button)) {
      try {
        await button.first().click();
      } catch {
        continue;
      }
    }
  }
};

const waitForResults = async (page: Page) => {
  await page.waitForLoadState("domcontentloaded", { timeout: SEARCH_TIMEOUT_MS });
  await page.waitForLoadState("networkidle", { timeout: SEARCH_TIMEOUT_MS }).catch(() => undefined);

  const resultLocator = page.locator(".price-label, [class*='price-label']");
  await resultLocator.first().waitFor({ timeout: RESULTS_TIMEOUT_MS });
};

const collectCurrentPageRows = async (
  page: Page,
  pickupDate: string,
  dropoffDate: string,
  depot: DepotCode,
  scrapeDate: string
) => {
  const blocks = page.locator(".price-label, [class*='price-label']");
  const count = await blocks.count();
  const rows: PriceRow[] = [];

  for (let index = 0; index < count; index += 1) {
    const payload = await blocks.nth(index).evaluate((node) => {
      const priceText = node.textContent || "";
      let current: HTMLElement | null = node.parentElement;
      let fullText = "";

      for (let hops = 0; hops < 10 && current; hops += 1) {
        fullText = (current.textContent || "").replace(/\s+/g, " ").trim();
        if (fullText.length > 50) {
          break;
        }
        current = current.parentElement;
      }

      return { priceText, fullText };
    });

    const price = cleanPrice(payload.priceText);
    const match = identifyVehicle(payload.fullText);

    if (!price || !match) {
      continue;
    }

    rows.push({
      pickup_date: pickupDate,
      dropoff_date: dropoffDate,
      location: depot,
      company: match.company,
      vehicle: match.vehicle,
      price,
      scrape_date: scrapeDate,
      type: match.type
    });
  }

  return rows;
};

const nextPage = async (page: Page) => {
  const candidates = [
    page.getByRole("link", { name: /next/i }),
    page.getByRole("button", { name: /next/i }),
    page.locator("a.next"),
    page.locator(".page-numbers.next")
  ];

  for (const candidate of candidates) {
    if (!(await isVisible(candidate))) {
      continue;
    }

    const control = candidate.first();

    try {
      const disabled =
        (await control.getAttribute("aria-disabled")) === "true" ||
        (await control.getAttribute("class"))?.includes("disabled");

      if (disabled) {
        return false;
      }

      await control.click();
      await pause(1500);
      await page.waitForLoadState("networkidle", { timeout: SEARCH_TIMEOUT_MS }).catch(() => undefined);
      return true;
    } catch {
      continue;
    }
  }

  return false;
};

const scrapeQuoteSet = async (
  page: Page,
  pickupDate: string,
  dropoffDate: string,
  depot: DepotCode,
  scrapeDate: string,
  warnings: string[]
) => {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: SEARCH_TIMEOUT_MS });
  await dismissOverlays(page);

  const locationReady = await fillLocationField(page, depot);
  const pickupReady = await fillDateField(page, pickupDate, "pickup");
  const dropoffReady = await fillDateField(page, dropoffDate, "dropoff");
  const submitted = await submitSearch(page);

  if (!locationReady || !pickupReady || !dropoffReady || !submitted) {
    warnings.push(
      `Unable to fully automate the search form for ${depot} ${pickupDate} -> ${dropoffDate}.`
    );
    await writeFile(
      path.join(paths.artifactsDir, `failed-form-${depot}-${pickupDate}-${dropoffDate}.html`),
      await page.content(),
      "utf8"
    );
    throw new Error(`Search form automation failed for ${depot} ${pickupDate} -> ${dropoffDate}`);
  }

  await waitForResults(page);

  const minimumByKey = new Map<string, PriceRow>();
  const seenPages = new Set<string>();

  while (true) {
    const pageRows = await collectCurrentPageRows(page, pickupDate, dropoffDate, depot, scrapeDate);
    pageRows.forEach((row) => {
      const key = [
        row.pickup_date,
        row.dropoff_date,
        row.location,
        row.company,
        row.vehicle
      ].join("|");
      const existing = minimumByKey.get(key);
      if (!existing || row.price < existing.price) {
        minimumByKey.set(key, row);
      }
    });

    const pageSignature = `${page.url()}|${pageRows.map((row) => `${row.company}:${row.vehicle}:${row.price}`).join(";")}`;
    if (seenPages.has(pageSignature)) {
      break;
    }
    seenPages.add(pageSignature);

    const advanced = await nextPage(page);
    if (!advanced) {
      break;
    }
  }

  return Array.from(minimumByKey.values());
};

export const runAutomatedScrape = async (
  request: ScrapeRequest,
  runId: string
): Promise<ScrapeRunResult> => {
  const browser = await chromium.launch({ headless: request.headless });
  const context = await browser.newContext({ locale: "en-NZ", timezoneId: "Pacific/Auckland" });
  const page = await context.newPage();
  const scrapeDate = new Date().toISOString().slice(0, 10);
  const warnings: string[] = [];
  const rows: PriceRow[] = [];
  let datesVisited = 0;

  try {
    for (const depot of request.locations) {
      const datePairs = generateDropoffDates(request.pickupDate, request.maxTripDays);

      for (const pair of datePairs) {
        datesVisited += 1;
        const pairRows = await scrapeQuoteSet(
          page,
          pair.pickupDate,
          pair.dropoffDate,
          depot,
          scrapeDate,
          warnings
        );
        rows.push(...pairRows);
      }
    }
  } catch (error) {
    await page.screenshot({
      path: path.join(paths.artifactsDir, `${runId}-error.png`),
      fullPage: true
    });
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }

  return { rows, datesVisited, warnings };
};
