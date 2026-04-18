import { writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import { BASE_URL, DEPOTS, generateDropoffDates, identifyVehicle } from "./config.js";
import { paths } from "./storage.js";
import type { DepotCode, PriceRow, ScrapeRequest, ScrapeRunResult } from "./types.js";

const SEARCH_TIMEOUT_MS = 20_000;
const RESULTS_TIMEOUT_MS = 30_000;
const SEARCH_FORM_SELECTOR = "form[action='/widget/book/search']";

const cleanPrice = (value: string) => {
  const matches = value.match(/\d+(?:\.\d+)?/g) || [];
  const values = matches
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry > 0);

  if (!values.length) {
    return null;
  }

  return Math.min(...values);
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
  await page.waitForLoadState("networkidle", { timeout: SEARCH_TIMEOUT_MS }).catch(() => undefined);
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll(".price-label, [class*='price-label']")).some((node) => {
        const element = node as HTMLElement;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.opacity !== "0"
        );
      }),
    { timeout: RESULTS_TIMEOUT_MS }
  );
};

const collectCurrentPageRows = async (
  page: Page,
  pickupDate: string,
  dropoffDate: string,
  depot: DepotCode,
  scrapeDate: string
) => {
  const payloads = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".price-label, [class*='price-label']")).flatMap((node) => {
      const element = node as HTMLElement;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      if (
        rect.width === 0 ||
        rect.height === 0 ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        return [];
      }

      const priceText = element.textContent || "";
      let current: HTMLElement | null = element.parentElement;
      let fullText = "";

      for (let hops = 0; hops < 10 && current; hops += 1) {
        fullText = (current.textContent || "").replace(/\s+/g, " ").trim();
        if (fullText.length > 50) {
          break;
        }
        current = current.parentElement;
      }

      return [{ priceText, fullText }];
    })
  );

  return payloads.flatMap((payload) => {
    const price = cleanPrice(payload.priceText);
    const match = identifyVehicle(payload.fullText);

    if (!price || !match) {
      return [];
    }

    return [
      {
        pickup_date: pickupDate,
        dropoff_date: dropoffDate,
        location: depot,
        company: match.company,
        vehicle: match.vehicle,
        price,
        scrape_date: scrapeDate,
        type: match.type
      }
    ];
  });
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
  await page.locator(SEARCH_FORM_SELECTOR).first().waitFor({ timeout: SEARCH_TIMEOUT_MS });

  const widgetReady = await fillBookingWidget(page, depot, pickupDate, dropoffDate);
  const submitted = await submitSearch(page);

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

  return { rows, datesVisited, warnings };
};
