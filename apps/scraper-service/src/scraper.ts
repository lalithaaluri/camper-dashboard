import { writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import { BASE_URL, DEPOTS, generateDropoffDates, identifyVehicle } from "./config.js";
import { paths } from "./storage.js";
import type { DepotCode, PriceRow, RoutePair, ScrapeRequest, ScrapeRunResult } from "./types.js";

export function generateCombos(startDate: string, pickupWindow: number) {
  const combos: Array<{ pickupDate: string; dropoffDate: string }> = [];
  const [startYear, startMonth, startDay] = startDate.split("-").map((value) => Number(value));
  const start = new Date(Date.UTC(startYear, startMonth - 1, startDay));

  for (let d = 0; d < pickupWindow; d += 1) {
    const currentPickup = new Date(start);
    currentPickup.setUTCDate(start.getUTCDate() + d);

    // Stop if pickup leaves the start month.
    if (currentPickup.getUTCMonth() !== start.getUTCMonth()) {
      break;
    }

    const currentPickupIso = currentPickup.toISOString().slice(0, 10);

    // Generate all dropoffs until month end for this pickup.
    for (let i = 1; i < 31; i += 1) {
      const dropoff = new Date(currentPickup);
      dropoff.setUTCDate(currentPickup.getUTCDate() + i);

      // Stop if dropoff leaves pickup month.
      if (dropoff.getUTCMonth() !== currentPickup.getUTCMonth()) {
        break;
      }

      combos.push({
        pickupDate: currentPickupIso,
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
const SEARCH_FORM_SELECTOR = "form[action='/widget/book/search']";
const RESULTS_SELECTOR = ".price-label, [class*='price-label']";
const PHASE_ONE_ALLOWED_CROSS_LOCATION_ROUTES = new Set([
  "auckland|christchurch",
  "christchurch|auckland"
]);

const cleanPrice = (value: string) => {
  const numeric = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
};

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

const setSelectizeValue = async (
  page: Page,
  selector: string,
  optionLabel: string
) =>
  page.evaluate(
    ({ selector, optionLabel }) => {
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

      const directMatch = groups.find(
        (group) => group.L === optionLabel && typeof group.V !== "undefined"
      );
      if (directMatch?.V !== undefined) {
        selectize.setValue(String(directMatch.V));
        return selectize.getValue() === String(directMatch.V);
      }

      const matchingGroup = groups.find(
        (group) => Array.isArray(group.O) && group.O.some((option) => option.L === optionLabel)
      );
      const matchingOption = matchingGroup?.O?.find((option) => option.L === optionLabel);
      if (!matchingGroup || !matchingOption) {
        return false;
      }

      selectize.setValue(String(matchingGroup.L));
      selectize.setValue(String(matchingOption.V));
      return selectize.getValue() === String(matchingOption.V);
    },
    { selector, optionLabel }
  );

const resolveSelectizeOptionValue = async (
  page: Page,
  selector: string,
  optionLabel: string
) =>
  page.evaluate(
    ({ selector, optionLabel }) => {
      const select = document.querySelector(selector) as HTMLSelectElement | null;
      if (!select) {
        return null;
      }

      const raw = select.getAttribute("data-options");
      const groups = raw
        ? (JSON.parse(raw) as Array<{
            L: string;
            V?: string | number;
            O?: Array<{ L: string; V: string | number }>;
          }>)
        : [];

      const directMatch = groups.find(
        (group) => group.L === optionLabel && typeof group.V !== "undefined"
      );
      if (directMatch?.V !== undefined) {
        return String(directMatch.V);
      }

      const matchingGroup = groups.find(
        (group) => Array.isArray(group.O) && group.O.some((option) => option.L === optionLabel)
      );
      const matchingOption = matchingGroup?.O?.find((option) => option.L === optionLabel);
      return matchingOption?.V !== undefined ? String(matchingOption.V) : null;
    },
    { selector, optionLabel }
  );

const setRouteSelections = async (
  page: Page,
  pickupDepot: DepotCode,
  dropoffDepot: DepotCode
) => {
  const pickupLabel = DEPOTS[pickupDepot].label;
  const dropoffLabel = DEPOTS[dropoffDepot].label;
  const pickupSelector = `${SEARCH_FORM_SELECTOR} select[name="Parameters.LocationFrom"]`;
  const dropoffSelector = `${SEARCH_FORM_SELECTOR} select[name="Parameters.LocationTo"]`;

  const expectedPickupValue = await resolveSelectizeOptionValue(page, pickupSelector, pickupLabel);
  const expectedDropoffValue = await resolveSelectizeOptionValue(page, dropoffSelector, dropoffLabel);

  if (!expectedPickupValue || !expectedDropoffValue || expectedDropoffValue === "0") {
    return { ok: false, expectedPickupValue, expectedDropoffValue };
  }

  const pickupSet = await setSelectizeValue(page, pickupSelector, pickupLabel);
  const dropoffSet = await setSelectizeValue(page, dropoffSelector, dropoffLabel);
  if (!pickupSet || !dropoffSet) {
    return { ok: false, expectedPickupValue, expectedDropoffValue };
  }

  const formState = await readSearchFormState(page);
  const pickupValueMatches = formState.locationFrom.value === expectedPickupValue;
  const dropoffValueMatches = formState.locationTo.value === expectedDropoffValue;
  const dropoffIsPlaceholder = formState.locationTo.value === "0";
  return {
    ok: pickupValueMatches && dropoffValueMatches && !dropoffIsPlaceholder,
    expectedPickupValue,
    expectedDropoffValue,
    state: formState
  };
};

const fillBookingWidget = async (
  page: Page,
  pickupDepot: DepotCode,
  dropoffDepot: DepotCode,
  pickupDate: string,
  dropoffDate: string
) => {
  const routeSelection = await setRouteSelections(page, pickupDepot, dropoffDepot);
  if (!routeSelection.ok) {
    return false;
  }

  const datesSet = await page.evaluate(
    ({ pickupDate, dropoffDate, pickupDisplayDate, dropoffDisplayDate, formSelector }) => {
      const form = document.querySelector(formSelector);
      if (!form) {
        return false;
      }

      const hiddenPickup = form.querySelector(
        'input[name="Parameters.DateFrom"]'
      ) as HTMLInputElement | null;
      const hiddenDropoff = form.querySelector(
        'input[name="Parameters.DateTo"]'
      ) as HTMLInputElement | null;
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

  return datesSet;
};

const readSearchFormState = async (page: Page) =>
  page.evaluate(({ formSelector }) => {
    const form = document.querySelector(formSelector);
    const fromSelect = document.querySelector(
      `${formSelector} select[name="Parameters.LocationFrom"]`
    ) as (HTMLSelectElement & { selectize?: Record<string, unknown> }) | null;
    const toSelect = document.querySelector(
      `${formSelector} select[name="Parameters.LocationTo"]`
    ) as (HTMLSelectElement & { selectize?: Record<string, unknown> }) | null;

    const fromSelectize = fromSelect?.selectize as
      | {
          getValue?: () => string;
          getItem?: (value: string) => HTMLElement | null;
        }
      | undefined;
    const toSelectize = toSelect?.selectize as
      | {
          getValue?: () => string;
          getItem?: (value: string) => HTMLElement | null;
        }
      | undefined;

    const fromValue = fromSelectize?.getValue?.() ?? fromSelect?.value ?? null;
    const toValue = toSelectize?.getValue?.() ?? toSelect?.value ?? null;

    const fromItemLabel =
      fromValue && fromSelectize?.getItem
        ? (fromSelectize.getItem(fromValue)?.textContent || "").trim()
        : null;
    const toItemLabel =
      toValue && toSelectize?.getItem
        ? (toSelectize.getItem(toValue)?.textContent || "").trim()
        : null;

    const fromOptionLabel =
      fromValue && fromSelect?.options
        ? fromSelect.options[fromSelect.selectedIndex]?.text?.trim() || null
        : null;
    const toOptionLabel =
      toValue && toSelect?.options
        ? toSelect.options[toSelect.selectedIndex]?.text?.trim() || null
        : null;

    const hiddenPickup = form?.querySelector(
      'input[name="Parameters.DateFrom"]'
    ) as HTMLInputElement | null;
    const hiddenDropoff = form?.querySelector(
      'input[name="Parameters.DateTo"]'
    ) as HTMLInputElement | null;

    return {
      locationFrom: {
        value: fromValue,
        label: fromItemLabel || fromOptionLabel
      },
      locationTo: {
        value: toValue,
        label: toItemLabel || toOptionLabel
      },
      pickupDate: hiddenPickup?.value || null,
      dropoffDate: hiddenDropoff?.value || null
    };
  }, { formSelector: SEARCH_FORM_SELECTOR });

const ensureWidgetStateBeforeSubmit = async (
  page: Page,
  pickupDepot: DepotCode,
  dropoffDepot: DepotCode,
  pickupDate: string,
  dropoffDate: string
) => {
  const expectedPickupLabel = DEPOTS[pickupDepot].label.toLowerCase();
  const expectedDropoffLabel = DEPOTS[dropoffDepot].label.toLowerCase();
  const pickupSelector = `${SEARCH_FORM_SELECTOR} select[name="Parameters.LocationFrom"]`;
  const dropoffSelector = `${SEARCH_FORM_SELECTOR} select[name="Parameters.LocationTo"]`;
  const expectedPickupValue = await resolveSelectizeOptionValue(
    page,
    pickupSelector,
    DEPOTS[pickupDepot].label
  );
  const expectedDropoffValue = await resolveSelectizeOptionValue(
    page,
    dropoffSelector,
    DEPOTS[dropoffDepot].label
  );

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const widgetReady = await fillBookingWidget(
      page,
      pickupDepot,
      dropoffDepot,
      pickupDate,
      dropoffDate
    );
    if (!widgetReady) {
      await pause(350);
      continue;
    }

    await pause(400);
    const formState = await readSearchFormState(page);
    const pickupMatches = formState.pickupDate === pickupDate;
    const dropoffMatches = formState.dropoffDate === dropoffDate;
    const fromLabelMatches =
      !formState.locationFrom.label ||
      formState.locationFrom.label.toLowerCase().includes(expectedPickupLabel);
    const toLabelMatches =
      !formState.locationTo.label ||
      formState.locationTo.label.toLowerCase().includes(expectedDropoffLabel);
    const routeLooksValid =
      Boolean(formState.locationFrom.value) &&
      Boolean(formState.locationTo.value) &&
      formState.locationTo.value !== "0" &&
      (!expectedPickupValue || formState.locationFrom.value === expectedPickupValue) &&
      (!expectedDropoffValue || formState.locationTo.value === expectedDropoffValue);

    if (
      pickupMatches &&
      dropoffMatches &&
      fromLabelMatches &&
      toLabelMatches &&
      routeLooksValid
    ) {
      return {
        ready: true,
        state: formState,
        expectedPickupValue,
        expectedDropoffValue
      };
    }
  }

  const finalState = await readSearchFormState(page);
  return {
    ready: false,
    state: finalState,
    expectedPickupValue,
    expectedDropoffValue
  };
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
  await page.waitForLoadState("domcontentloaded", { timeout: SEARCH_TIMEOUT_MS });
  await page.waitForLoadState("networkidle", { timeout: SEARCH_TIMEOUT_MS }).catch(() => undefined);
  // Python flow uses sleep and then scrapes; do the same by waiting for attachment, not visibility.
  await page.waitForSelector(RESULTS_SELECTOR, { timeout: RESULTS_TIMEOUT_MS, state: "attached" });
  await page.waitForTimeout(8_000);
};

const collectCurrentPageRows = async (
  page: Page,
  pickupDate: string,
  dropoffDate: string,
  pickupDepot: DepotCode,
  dropoffDepot: DepotCode,
  scrapeDate: string
) => {
  const blocks = page.locator(RESULTS_SELECTOR);
  const count = await blocks.count();
  const rows: PriceRow[] = [];

  console.log("[SCRAPER] Vehicles/price blocks found:", count);

  for (let index = 0; index < count; index += 1) {
    const payload = await blocks.nth(index).evaluate((node) => {
      let current = node.parentElement;
      let fullText = "";
      let cardRoot: Element = node;

      for (let hops = 0; hops < 10 && current; hops += 1) {
        fullText = (current.textContent || "").replace(/\s+/g, " ").trim();
        cardRoot = current;
        if (fullText.length > 50) {
          break;
        }
        current = current.parentElement;
      }

      const candidates = Array.from(
        cardRoot.querySelectorAll("p, span, strong, b, div")
      )
        .flatMap((element) => {
          const text = (element.textContent || "").replace(/\s+/g, " ").trim();
          if (!text || !/[\d]/.test(text)) {
            return [];
          }

          const matches = Array.from(text.matchAll(/\$?\s*\d[\d,]*(?:\.\d{2})?/g)).map(
            (entry) => entry[0]
          );
          if (!matches.length) {
            return [];
          }

          const style = window.getComputedStyle(element);
          const className = (element.getAttribute("class") || "").toLowerCase();
          const textDecoration = (style.textDecoration || "").toLowerCase();
          const lowered = text.toLowerCase();
          const isStruck =
            textDecoration.includes("line-through") ||
            className.includes("strike") ||
            className.includes("strikethrough") ||
            className.includes("old") ||
            className.includes("was") ||
            lowered.includes("was ");
          const isFeeLike =
            lowered.includes("fee") ||
            lowered.includes("surcharge") ||
            lowered.includes("deposit");
          const isCurrentLike =
            className.includes("price-label") ||
            className.includes("current") ||
            className.includes("now") ||
            className.includes("total");

          let baseScore = 0;
          if (isCurrentLike) baseScore += 3;
          if (isFeeLike) baseScore -= 2;
          if (isStruck) baseScore -= 6;
          if (text.includes("$")) baseScore += 1;
          if (text.length < 24) baseScore += 1;

          // Some cards include old+new prices in the same text node.
          // Prefer later token in that text because current displayed value is often last.
          return matches.map((matched, tokenIndex) => ({
            text,
            matched,
            score: baseScore + tokenIndex
          }));
        })
        .sort((left, right) => right.score - left.score);

      const fallbackText = (node.textContent || "").replace(/\s+/g, " ").trim();
      const selected = candidates[0]?.matched || fallbackText;

      return {
        selectedPriceText: selected,
        fullText
      };
    });

    const price = cleanPrice(payload.selectedPriceText);
    const match = identifyVehicle(payload.fullText);

    if (!price || !match) {
      continue;
    }

    console.log("[SCRAPER] Extracted:", {
      company: match.company,
      vehicle: match.vehicle,
      type: match.type,
      price
    });

    rows.push({
      pickup_date: pickupDate,
      dropoff_date: dropoffDate,
      pickup_location: pickupDepot,
      dropoff_location: dropoffDepot,
      location: pickupDepot,
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
      await pause(1_500);
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
  pickupDepot: DepotCode,
  dropoffDepot: DepotCode,
  scrapeDate: string,
  warnings: string[]
) => {
  let submitted = false;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    console.log(
      `[SCRAPER] Loading page for ${pickupDepot}->${dropoffDepot} ${pickupDate} -> ${dropoffDate} (attempt ${attempt}/2)`
    );
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: SEARCH_TIMEOUT_MS });
    await dismissOverlays(page);
    await page.locator(SEARCH_FORM_SELECTOR).first().waitFor({ timeout: SEARCH_TIMEOUT_MS });
    console.log("[SCRAPER] Search form loaded");

    const widgetSetup = await ensureWidgetStateBeforeSubmit(
      page,
      pickupDepot,
      dropoffDepot,
      pickupDate,
      dropoffDate
    );
    console.log("[SCRAPER][SUBMIT-CHECK]", {
      requestedRoute: `${pickupDepot}->${dropoffDepot}`,
      expectedPickupDepot: pickupDepot,
      expectedDropoffDepot: dropoffDepot,
      expectedPickupLabel: DEPOTS[pickupDepot].label,
      expectedDropoffLabel: DEPOTS[dropoffDepot].label,
      expectedPickupValue: widgetSetup.expectedPickupValue ?? null,
      expectedDropoffValue: widgetSetup.expectedDropoffValue ?? null,
      pickupDate,
      dropoffDate,
      attempt,
      domLocationFrom: widgetSetup.state.locationFrom,
      domLocationTo: widgetSetup.state.locationTo,
      domPickupDate: widgetSetup.state.pickupDate,
      domDropoffDate: widgetSetup.state.dropoffDate
    });

    if (!widgetSetup.ready) {
      if (attempt === 2) {
        break;
      }
      continue;
    }

    submitted = await submitSearch(page);
    if (submitted) {
      break;
    }
  }

  if (!submitted) {
    warnings.push(
      `Unable to fully automate the search form for ${pickupDepot}->${dropoffDepot} ${pickupDate} -> ${dropoffDate}.`
    );
    await writeFile(
      path.join(
        paths.artifactsDir,
        `failed-form-${pickupDepot}-${dropoffDepot}-${pickupDate}-${dropoffDate}.html`
      ),
      await page.content(),
      "utf8"
    );
    await page.screenshot({
      path: path.join(
        paths.artifactsDir,
        `failed-form-${pickupDepot}-${dropoffDepot}-${pickupDate}-${dropoffDate}.png`
      ),
      fullPage: true
    }).catch(() => undefined);
    throw new Error(
      `Search form automation failed for ${pickupDepot}->${dropoffDepot} ${pickupDate} -> ${dropoffDate}`
    );
  }

  console.log("[SCRAPER] Search submitted, waiting for results");
  await waitForResults(page);
  console.log("[SCRAPER] Results page loaded:", page.url());

  const minimumByKey = new Map<string, PriceRow>();
  const seenPages = new Set<string>();

  while (true) {
    const pageRows = await collectCurrentPageRows(
      page,
      pickupDate,
      dropoffDate,
      pickupDepot,
      dropoffDepot,
      scrapeDate
    );
    pageRows.forEach((row) => {
      const key = [
        row.pickup_date,
        row.dropoff_date,
        row.pickup_location ?? row.location,
        row.dropoff_location ?? row.location,
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

  console.log("[SCRAPER] Combo summary:", {
    route: `${pickupDepot}->${dropoffDepot}`,
    pickupDate,
    dropoffDate,
    rows: minimumByKey.size,
    elements: Array.from(minimumByKey.values()).filter((row) => row.type === "elements").length,
    competitors: Array.from(minimumByKey.values()).filter((row) => row.type === "competitor").length
  });

  return Array.from(minimumByKey.values());
};

const resolveRoutePairs = (request: ScrapeRequest): RoutePair[] => {
  if (request.routePairs.length > 0) {
    return request.routePairs;
  }

  return request.locations.map((location) => ({
    pickupLocation: location,
    dropoffLocation: location
  }));
};

const validatePhaseOneCrossLocationScope = (request: ScrapeRequest, routePairs: RoutePair[]) => {
  const hasCrossLocation = routePairs.some(
    (pair) => pair.pickupLocation !== pair.dropoffLocation
  );

  if (!hasCrossLocation) {
    return;
  }

  const pickupMonth = request.pickupDate.slice(5, 7);
  if (pickupMonth !== "06") {
    throw new Error("Phase 1 cross-location scraping is limited to June pickup dates.");
  }

  for (const pair of routePairs) {
    if (pair.pickupLocation === pair.dropoffLocation) {
      continue;
    }

    const key = `${pair.pickupLocation}|${pair.dropoffLocation}`;
    if (!PHASE_ONE_ALLOWED_CROSS_LOCATION_ROUTES.has(key)) {
      throw new Error(
        `Unsupported cross-location route for Phase 1: ${pair.pickupLocation}->${pair.dropoffLocation}`
      );
    }
  }
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
  console.log("[SCRAPER] Run started:", {
    runId,
    pickupDate: request.pickupDate,
    locations: request.locations,
    routePairs: request.routePairs,
    maxTripDays: request.maxTripDays,
    headless: request.headless
  });

  const browser = await chromium.launch({ headless: request.headless });
  const context = await browser.newContext({ locale: "en-NZ", timezoneId: "Pacific/Auckland" });
  const page = await context.newPage();
  const scrapeDate = new Date().toISOString().slice(0, 10);
  const warnings: string[] = [];
  const rows: PriceRow[] = [];
  let datesVisited = 0;
  const routePairs = resolveRoutePairs(request);
  validatePhaseOneCrossLocationScope(request, routePairs);

  try {
    for (const routePair of routePairs) {
      const datePairs = generateDateCombinations(request.pickupDate, request.maxTripDays);
      if (datePairs.length === 0) {
        throw new Error("No date combinations generated");
      }

      const pickupDatesVisited = new Set<string>();
      for (const pair of datePairs) {
        if (!pickupDatesVisited.has(pair.pickupDate)) {
          pickupDatesVisited.add(pair.pickupDate);
          datesVisited += 1;
        }
        console.log("[SCRAPER] Processing combo:", {
          route: `${routePair.pickupLocation}->${routePair.dropoffLocation}`,
          pickupDate: pair.pickupDate,
          dropoffDate: pair.dropoffDate
        });

        try {
          console.log("Scraping:", pair.pickupDate, "→", pair.dropoffDate);
          const pairRows = await scrapeQuoteSet(
            page,
            pair.pickupDate,
            pair.dropoffDate,
            routePair.pickupLocation,
            routePair.dropoffLocation,
            scrapeDate,
            warnings
          );
          rows.push(...pairRows);

          await onProgress?.({
            rowsProcessed: rows.length,
            datesVisited,
            pairRows
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown error";
          console.error("[SCRAPER] Combo failed:", { routePair, pair, message });
          warnings.push(
            `Combo failed for ${routePair.pickupLocation}->${routePair.dropoffLocation} ${pair.pickupDate} -> ${pair.dropoffDate}: ${message}`
          );
          await onProgress?.({
            rowsProcessed: rows.length,
            datesVisited,
            pairRows: []
          });
        }
      }
    }
  } catch (error) {
    console.error("[SCRAPER] Fatal run error:", error);
    const originalMessage = error instanceof Error ? error.message : "Unknown scraping error";
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

  console.log("[SCRAPER] Run finished:", {
    runId,
    rowsProcessed: rows.length,
    datesVisited,
    warnings: warnings.length
  });

  return { rows, rowsProcessed: rows.length, datesVisited, warnings };
};
