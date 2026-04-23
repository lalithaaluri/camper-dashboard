import { writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import { BASE_URL, DEPOTS, identifyVehicle } from "./config.js";
import { paths } from "./storage.js";
import type { DepotCode, PriceRow, ScrapeRequest, ScrapeRunResult } from "./types.js";

export function generateCombos(pickupDate: string, pickupDays: number) {
  const combos: Array<{ pickupDate: string; dropoffDate: string }> = [];
  const [startYear, startMonth, startDay] = pickupDate.split("-").map((value) => Number(value));
  const start = new Date(Date.UTC(startYear, startMonth - 1, startDay));

  for (let i = 0; i < pickupDays; i += 1) {
    const pickup = new Date(start);
    pickup.setUTCDate(start.getUTCDate() + i);

    const year = pickup.getUTCFullYear();
    const month = pickup.getUTCMonth();

    for (let j = pickup.getUTCDate() + 1; j <= 31; j += 1) {
      const dropoff = new Date(Date.UTC(year, month, j));
      if (dropoff.getUTCMonth() !== month) {
        break;
      }

      combos.push({
        pickupDate: pickup.toISOString().slice(0, 10),
        dropoffDate: dropoff.toISOString().slice(0, 10)
      });
    }
  }

  return combos;
}

export function generateMultiMonthMatrix(startDate: string, tripDays: number) {
  return generateCombos(startDate, tripDays);
}

export function generateDateCombinations(pickupDate: string, maxTripDays: number) {
  return generateCombos(pickupDate, maxTripDays);
}

const SEARCH_TIMEOUT_MS = 20_000;
const RESULTS_TIMEOUT_MS = 30_000;
const RESULTS_SELECTOR = ".price-label, [class*='price-label']";
const RESULTS_CONTAINER_SELECTOR = ".vehicle-card, .price-label";
const SEARCH_URL = BASE_URL;
const SEARCH_FORM_SELECTOR = "form[action='/widget/book/search']";

const cleanPrice = (value: string) => {
  const compact = value.replace(/,/g, "");
  const directParsed = Number.parseFloat(compact.replace(/[^0-9.]/g, ""));
  if (Number.isFinite(directParsed) && directParsed > 0) {
    return directParsed;
  }

  const matches = compact.match(/\d+(?:\.\d+)?/g) || [];
  const values = matches
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry > 0);

  if (!values.length) {
    return null;
  }

  return Math.max(...values);
};

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

const escapeForRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const formatDisplayDate = (value: string) => {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
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

const setSelectizeValue = async (
  page: Page,
  selector: string,
  optionLabel: string,
  allowSameAsPickup = false
) =>
  page.evaluate(
    ({ selector, optionLabel, allowSameAsPickup }) => {
      const select = document.querySelector(selector) as
        | (HTMLSelectElement & { selectize?: Record<string, unknown> })
        | null;

      if (!select?.selectize) {
        return false;
      }

      const selectize = select.selectize as {
        getValue: () => string;
        setValue: (value: string) => void;
      };

      const raw = select.getAttribute("data-options");
      const groups = raw
        ? (JSON.parse(raw) as Array<{
            L: string;
            V?: string | number;
            O?: Array<{ L: string; V: string | number }>;
          }>)
        : [];

      if (!groups.length) {
        return false;
      }

      let directValue: string | null = null;
      for (const group of groups) {
        if (group.L === optionLabel && typeof group.V !== "undefined") {
          directValue = String(group.V);
          break;
        }
      }

      if (directValue !== null) {
        selectize.setValue(directValue);
        return selectize.getValue() === directValue;
      }

      if (allowSameAsPickup) {
        for (const group of groups) {
          if (group.L === "Same as Pick Up" && typeof group.V !== "undefined") {
            const sameAsPickupValue = String(group.V);
            selectize.setValue(sameAsPickupValue);
            return selectize.getValue() === sameAsPickupValue;
          }
        }
      }

      let matchingGroupLabel: string | null = null;
      let matchingOptionValue: string | null = null;
      for (const group of groups) {
        if (!Array.isArray(group.O)) {
          continue;
        }

        for (const option of group.O) {
          if (option.L === optionLabel) {
            matchingGroupLabel = group.L;
            matchingOptionValue = String(option.V);
            break;
          }
        }

        if (matchingGroupLabel && matchingOptionValue) {
          break;
        }
      }

      if (!matchingGroupLabel || !matchingOptionValue) {
        return false;
      }

      selectize.setValue(matchingGroupLabel);
      selectize.setValue(matchingOptionValue);

      return selectize.getValue() === matchingOptionValue;
    },
    { selector, optionLabel, allowSameAsPickup }
  );

const fillBookingWidget = async (
  page: Page,
  depot: DepotCode,
  pickupDate: string,
  dropoffDate: string
) => {
  const pickupLabel = DEPOTS[depot].label;

  const pickupSet = await setSelectizeValue(
    page,
    `${SEARCH_FORM_SELECTOR} select[name="Parameters.LocationFrom"]`,
    pickupLabel
  );
  const dropoffSet = await setSelectizeValue(
    page,
    `${SEARCH_FORM_SELECTOR} select[name="Parameters.LocationTo"]`,
    pickupLabel,
    true
  );

  const datesSet = await page.evaluate(
    ({ pickupDate, dropoffDate, pickupDisplayDate, dropoffDisplayDate, formSelector }) => {
      const form = document.querySelector(formSelector);
      if (!form) {
        return false;
      }

      const hiddenPickup = form.querySelector('input[name="Parameters.DateFrom"]') as HTMLInputElement | null;
      const hiddenDropoff = form.querySelector('input[name="Parameters.DateTo"]') as HTMLInputElement | null;
      const visiblePickup = form.querySelector(".display-fr") as HTMLInputElement | null;
      const visibleDropoff = form.querySelector(".display-to") as HTMLInputElement | null;

      if (!hiddenPickup || !hiddenDropoff || !visiblePickup || !visibleDropoff) {
        return false;
      }

      hiddenPickup.value = pickupDate;
      hiddenDropoff.value = dropoffDate;
      visiblePickup.value = pickupDisplayDate;
      visibleDropoff.value = dropoffDisplayDate;

      for (const field of [hiddenPickup, hiddenDropoff, visiblePickup, visibleDropoff]) {
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
      }

      return true;
    },
    {
      pickupDate,
      dropoffDate,
      pickupDisplayDate: formatDisplayDate(pickupDate),
      dropoffDisplayDate: formatDisplayDate(dropoffDate),
      formSelector: SEARCH_FORM_SELECTOR
    }
  );

  return pickupSet && dropoffSet && datesSet;
};

const submitSearch = async (page: Page) => {
  const button = page.locator(`${SEARCH_FORM_SELECTOR} button.button-search`).first();
  if (!(await isVisible(button))) {
    return false;
  }

  try {
    await button.click();
    return true;
  } catch {
    return false;
  }
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
  await page.waitForURL(
    new RegExp(`${escapeForRegExp(BASE_URL)}/bookings/\\?__p=book_search_`, "i"),
    { timeout: RESULTS_TIMEOUT_MS }
  );
  await page.waitForLoadState("domcontentloaded", { timeout: SEARCH_TIMEOUT_MS });
};

const collectCurrentPageRows = async (
  page: Page,
  pickupDate: string,
  dropoffDate: string,
  depot: DepotCode,
  scrapeDate: string,
  stats?: {
    skippedInvalidRows: number;
    skippedUnmatchedRows: number;
  }
) => {
  const payloads = await page.evaluate(() => {
    const isVisible = (element: HTMLElement | null) => {
      if (!element) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return !(
        rect.width === 0 ||
        rect.height === 0 ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      );
    };

    const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();

    const cards = Array.from(
      document.querySelectorAll(".vehicle-card, .result-item, .search-result-item")
    ) as HTMLElement[];
    const cardPayloads = cards.flatMap((card) => {
      if (!isVisible(card)) {
        return [];
      }

      const priceNode = card.querySelector(".price-label, [class*='price-label']") as HTMLElement | null;
      if (!isVisible(priceNode)) {
        return [];
      }

      return [
        {
          priceText: priceNode?.textContent || "",
          fullText: normalizeText(card.textContent || "")
        }
      ];
    });

    if (cardPayloads.length > 0) {
      return cardPayloads;
    }

    return Array.from(document.querySelectorAll(".price-label, [class*='price-label']")).flatMap((node) => {
      const element = node as HTMLElement;
      if (!isVisible(element)) {
        return [];
      }

      const priceText = element.textContent || "";
      let current: HTMLElement | null = element.parentElement;
      let fullText = "";

      for (let hops = 0; hops < 10 && current; hops += 1) {
        fullText = normalizeText(current.textContent || "");
        if (fullText.length > 50) {
          break;
        }
        current = current.parentElement;
      }

      return [{ priceText, fullText }];
    });
  });

  return payloads.flatMap((payload) => {
    const price = cleanPrice(payload.priceText);
    console.log("DEBUG PRICE:", price, typeof price);
    const fullText = String(payload.fullText || "");

    let match:
      | {
          company: string;
          vehicle: string;
          type: "elements";
        }
      | ReturnType<typeof identifyVehicle> = null;

    const text = fullText.toLowerCase();

    if (text.includes("trek")) {
      let vehicle = "trek";

      if (text.includes("large")) {
        vehicle = "trek large";
      } else if (text.includes("medium")) {
        vehicle = "trek medium";
      } else if (text.includes("budget")) {
        vehicle = "trek budget";
      }

      match = {
        company: "elementsworld",
        vehicle,
        type: "elements"
      };
    }

    if (!match) {
      match = identifyVehicle(payload.fullText);
    }

    if (!match) {
      if (stats) {
        stats.skippedUnmatchedRows += 1;
      }
      return [];
    }

    const parsedPrice = Number(price);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 50) {
      if (stats) {
        stats.skippedInvalidRows += 1;
      }
      console.log("Skipping invalid price row:", {
        priceText: payload.priceText,
        pickup_date: pickupDate,
        dropoff_date: dropoffDate,
        company: match.company,
        vehicle: match.vehicle,
        price: parsedPrice
      });
      return [];
    }

    return [
      {
        pickup_date: pickupDate,
        dropoff_date: dropoffDate,
        location: depot,
        company: match.company,
        vehicle: match.vehicle,
        price: parsedPrice,
        scrape_date: scrapeDate,
        type: match.type
      }
    ];
  });
};

const scrapeQuoteSet = async (
  page: Page,
  pickupDate: string,
  dropoffDate: string,
  depot: DepotCode,
  scrapeDate: string,
  warnings: string[]
) => {
  await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: SEARCH_TIMEOUT_MS });
  await dismissOverlays(page);
  await page.locator(SEARCH_FORM_SELECTOR).first().waitFor({ timeout: SEARCH_TIMEOUT_MS });

  const pickupInput = page.locator('input[name="pickup_date"]').first();
  const dropoffInput = page.locator('input[name="dropoff_date"]').first();
  await tryFill(pickupInput, "");
  await tryFill(dropoffInput, "");
  await tryFill(pickupInput, pickupDate);
  await tryFill(dropoffInput, dropoffDate);

  const widgetReady = await fillBookingWidget(page, depot, pickupDate, dropoffDate);
  await page.waitForSelector('button[type="submit"]', {
    state: "visible",
    timeout: SEARCH_TIMEOUT_MS
  }).catch(() => undefined);

  let submitted = false;
  try {
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: SEARCH_TIMEOUT_MS }),
      page.click('button[type="submit"]')
    ]);
    submitted = true;
  } catch {
    try {
      await page.click('button[type="submit"]');
      await page.waitForLoadState("domcontentloaded", { timeout: SEARCH_TIMEOUT_MS }).catch(() => undefined);
      submitted = true;
    } catch {
      submitted = await submitSearch(page);
    }
  }

  if (!widgetReady || !submitted) {
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
  await page.waitForSelector(RESULTS_CONTAINER_SELECTOR, { timeout: 15_000 }).catch(() => undefined);
  await page.waitForLoadState("domcontentloaded", { timeout: SEARCH_TIMEOUT_MS }).catch(() => undefined);
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 300;
      const timer = window.setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight) {
          window.clearInterval(timer);
          resolve();
        }
      }, 200);
    });
  });
  await page.waitForTimeout(2000);
  await page.waitForTimeout(3000);

  let priceElements: Awaited<ReturnType<Page["locator"]>["all"]> = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    priceElements = await page.locator(RESULTS_SELECTOR).all();

    if (priceElements.length > 0) {
      break;
    }

    console.log("Waiting for results...");
    await page.waitForTimeout(1500);
  }

  if (priceElements.length === 0) {
    console.log("No results after retry, continuing extraction pass...");
  }

  const results = priceElements.length;
  console.log("Results found:", results);
  if (results < 5) {
    const warning = `Low result count (${results}) for ${depot} ${pickupDate} -> ${dropoffDate}.`;
    console.warn(warning);
    warnings.push(warning);
  }

  const minimumByKey = new Map<string, PriceRow>();
  const seenPages = new Set<string>();
  const pages = page.locator(".pagination a");
  let pageIndex = 0;
  let totalVehiclesFound = 0;
  let competitorRowsFound = 0;
  let elementsRowsFound = 0;
  const extractionStats = {
    skippedInvalidRows: 0,
    skippedUnmatchedRows: 0
  };

  while (true) {
    console.log("Scraping page:", pageIndex + 1);

    const pageRows = await collectCurrentPageRows(
      page,
      pickupDate,
      dropoffDate,
      depot,
      scrapeDate,
      extractionStats
    );
    totalVehiclesFound += pageRows.length;
    competitorRowsFound += pageRows.filter((row) => row.type === "competitor").length;
    elementsRowsFound += pageRows.filter((row) => row.type === "elements").length;

    pageRows.forEach((row) => {
      const key = `${row.pickup_date}_${row.dropoff_date}_${row.location}_${row.company}_${row.vehicle}`;
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

    const nextPage = pages.nth(pageIndex + 1);
    if (!(await nextPage.isVisible())) {
      console.log("No more pages");
      break;
    }

    await Promise.all([
      nextPage.click(),
      page.waitForLoadState("networkidle", { timeout: SEARCH_TIMEOUT_MS }).catch(() => undefined)
    ]);

    pageIndex += 1;
  }

  console.log("Combo extraction summary:", {
    pickup_date: pickupDate,
    dropoff_date: dropoffDate,
    location: depot,
    totalVehiclesFound,
    competitorRowsFound,
    elementsRowsFound,
    skippedInvalidRows: extractionStats.skippedInvalidRows,
    skippedUnmatchedRows: extractionStats.skippedUnmatchedRows,
    reducedRows: minimumByKey.size
  });

  return Array.from(minimumByKey.values());
};

export const runAutomatedScrape = async (
  request: ScrapeRequest,
  runId: string,
  onProgress?: (progress: {
    rowsProcessed: number;
    datesVisited: number;
    pairRows: PriceRow[];
  }) => Promise<void> | void
): Promise<ScrapeRunResult> => {
  const browser = await chromium.launch({ headless: request.headless });
  const context = await browser.newContext({ locale: "en-NZ", timezoneId: "Pacific/Auckland" });
  const page = await context.newPage();
  const scrapeDate = new Date().toISOString().slice(0, 10);
  const warnings: string[] = [];
  const rows: PriceRow[] = [];
  let consecutiveNoInsertCombos = 0;
  let datesVisited = 0;
  const pickupDate = request.pickupDate;
  const maxTripDays =
    (request as ScrapeRequest & { tripDays?: number }).tripDays ?? request.maxTripDays;

  console.log("Starting scrape with:");
  console.log("pickupDate received:", pickupDate);
  console.log("maxTripDays:", maxTripDays);

  try {
    for (const depot of request.locations) {
      const dates = generateDateCombinations(pickupDate, maxTripDays);
      console.log("Generated dates count:", dates.length);
      console.log("Entering loop");

      if (dates.length === 0) {
        throw new Error("No date combinations generated");
      }

      for (const combo of dates) {
        console.log("Processing combo:", combo);
        datesVisited += 1;
        try {
          const pairRows = await scrapeQuoteSet(
            page,
            combo.pickupDate,
            combo.dropoffDate,
            depot,
            scrapeDate,
            warnings
          );
          if (pairRows.length === 0) {
            consecutiveNoInsertCombos += 1;
            const warning = `No rows extracted for combo ${depot} ${combo.pickupDate} -> ${combo.dropoffDate}.`;
            console.warn(warning);
            warnings.push(warning);
          } else {
            consecutiveNoInsertCombos = 0;
          }

          rows.push(...pairRows);
          await onProgress?.({
            rowsProcessed: rows.length,
            datesVisited,
            pairRows
          });

          if (consecutiveNoInsertCombos >= 5) {
            const warning = `Stopping early after ${consecutiveNoInsertCombos} consecutive combos with zero rows.`;
            console.warn(warning);
            warnings.push(warning);
            break;
          }
        } catch (error) {
          console.error(
            `SCRAPER ERROR: combo failed for ${depot} ${combo.pickupDate} -> ${combo.dropoffDate}`,
            error
          );
          warnings.push(
            `Combo failed for ${depot} ${combo.pickupDate} -> ${combo.dropoffDate}: ${
              error instanceof Error ? error.message : "unknown error"
            }`
          );
          await onProgress?.({
            rowsProcessed: rows.length,
            datesVisited,
            pairRows: []
          });
          consecutiveNoInsertCombos += 1;
          if (consecutiveNoInsertCombos >= 5) {
            const warning = `Stopping early after ${consecutiveNoInsertCombos} consecutive failed/empty combos.`;
            console.warn(warning);
            warnings.push(warning);
            break;
          }
          continue;
        }
      }
    }
  } catch (error) {
    console.error("SCRAPER ERROR:", error);
    const originalMessage =
      error instanceof Error ? error.message : "Unknown scraping error";
    const diagnostics: string[] = [];

    try {
      await writeFile(
        path.join(paths.artifactsDir, `${runId}-error.html`),
        await page.content(),
        "utf8"
      );
      diagnostics.push(`${runId}-error.html`);
    } catch (artifactError) {
      diagnostics.push(
        `html-capture-failed: ${
          artifactError instanceof Error ? artifactError.message : "unknown error"
        }`
      );
    }

    try {
      await page.screenshot({
        path: path.join(paths.artifactsDir, `${runId}-error.png`),
        fullPage: true
      });
      diagnostics.push(`${runId}-error.png`);
    } catch (artifactError) {
      diagnostics.push(
        `screenshot-failed: ${
          artifactError instanceof Error ? artifactError.message : "unknown error"
        }`
      );
    }

    throw new Error(
      diagnostics.length
        ? `${originalMessage} | diagnostics: ${diagnostics.join(", ")}`
        : originalMessage
    );
  } finally {
    await context.close();
    await browser.close();
  }

  return { rows, rowsProcessed: rows.length, datesVisited, warnings };
};
