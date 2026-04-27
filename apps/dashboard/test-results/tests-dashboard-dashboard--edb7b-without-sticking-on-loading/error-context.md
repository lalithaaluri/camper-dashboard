# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests\dashboard.spec.ts >> dashboard loads SQLite pricing data and renders KPI/table without sticking on loading
- Location: tests\dashboard.spec.ts:244:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: /AI-Assisted Pricing Decision Support/i })
Expected: visible
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 60000ms
  - waiting for getByRole('heading', { name: /AI-Assisted Pricing Decision Support/i })

```

# Test source

```ts
  149 |     } catch {
  150 |       // retry
  151 |     }
  152 | 
  153 |     await new Promise((resolveTimer) => setTimeout(resolveTimer, 250));
  154 |   }
  155 | 
  156 |   throw new Error(`Timed out waiting for ${url}`);
  157 | };
  158 | 
  159 | const stopProcess = async (processHandle: any) => {
  160 |   if (!processHandle || processHandle.killed) {
  161 |     return;
  162 |   }
  163 | 
  164 |   processHandle.kill("SIGTERM");
  165 | 
  166 |   await new Promise<void>((resolveDone) => {
  167 |     const timeout = setTimeout(() => {
  168 |       if (!processHandle.killed) {
  169 |         processHandle.kill("SIGKILL");
  170 |       }
  171 |       resolveDone();
  172 |     }, 4000);
  173 | 
  174 |     processHandle.once("exit", () => {
  175 |       clearTimeout(timeout);
  176 |       resolveDone();
  177 |     });
  178 |   });
  179 | };
  180 | 
  181 | test.beforeAll(async () => {
  182 |   const runtime = createRuntime();
  183 |   runtimeDir = runtime.runtimeDir;
  184 |   seedDatabase(runtime.dbPath, seededRows);
  185 | 
  186 |   const apiPort = 4900 + Math.floor(Math.random() * 100);
  187 |   const dashboardPort = 3000;
  188 | 
  189 |   apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  190 |   dashboardBaseUrl = `http://127.0.0.1:${dashboardPort}`;
  191 | 
  192 |   apiProcess = spawn(process.execPath, ["src/server.js"], {
  193 |     cwd: runtimeDir,
  194 |     env: {
  195 |       ...process.env,
  196 |       PORT: String(apiPort)
  197 |     },
  198 |     stdio: "pipe"
  199 |   });
  200 | 
  201 |   await waitForHttp(`${apiBaseUrl}/api/health`, 12000);
  202 | 
  203 |   if (process.platform === "win32") {
  204 |     const comspec = process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
  205 |     dashboardProcess = spawn(comspec, ["/d", "/s", "/c", "pnpm --filter dashboard start"], {
  206 |       cwd: repoRoot,
  207 |       env: {
  208 |         ...process.env,
  209 |         CI: "true",
  210 |         BROWSER: "none",
  211 |         PORT: String(dashboardPort),
  212 |         REACT_APP_PRICING_API_URL: apiBaseUrl,
  213 |         REACT_APP_SCRAPER_API_URL: "http://127.0.0.1:1"
  214 |       },
  215 |       stdio: "pipe"
  216 |     });
  217 |   } else {
  218 |     dashboardProcess = spawn("pnpm", ["--filter", "dashboard", "start"], {
  219 |       cwd: repoRoot,
  220 |       env: {
  221 |         ...process.env,
  222 |         CI: "true",
  223 |         BROWSER: "none",
  224 |         PORT: String(dashboardPort),
  225 |         REACT_APP_PRICING_API_URL: apiBaseUrl,
  226 |         REACT_APP_SCRAPER_API_URL: "http://127.0.0.1:1"
  227 |       },
  228 |       stdio: "pipe"
  229 |     });
  230 |   }
  231 | 
  232 |   await waitForHttp(dashboardBaseUrl, 90000);
  233 | });
  234 | 
  235 | test.afterAll(async () => {
  236 |   await stopProcess(dashboardProcess);
  237 |   await stopProcess(apiProcess);
  238 | 
  239 |   if (runtimeDir && existsSync(runtimeDir)) {
  240 |     rmSync(runtimeDir, { recursive: true, force: true });
  241 |   }
  242 | });
  243 | 
  244 | test("dashboard loads SQLite pricing data and renders KPI/table without sticking on loading", async ({ page }: any) => {
  245 |   await page.goto(dashboardBaseUrl, { waitUntil: "domcontentloaded" });
  246 | 
  247 |   await expect(
  248 |     page.getByRole("heading", { name: /AI-Assisted Pricing Decision Support/i })
> 249 |   ).toBeVisible({ timeout: 60000 });
      |     ^ Error: expect(locator).toBeVisible() failed
  250 |   await expect(page.getByText(/Loading dashboard/i)).toHaveCount(0);
  251 | 
  252 |   await expect(page.getByText(/Recommended price/i)).toBeVisible();
  253 |   await expect(page.locator(".hero-highlight strong").first()).not.toHaveText("N/A");
  254 | 
  255 |   await page.getByRole("button", { name: /Competitors/i }).click();
  256 |   await expect(page.getByRole("heading", { name: /Competitor rows/i })).toBeVisible();
  257 | 
  258 |   const tableRows = page.locator("table tbody tr");
  259 |   await expect(tableRows.first()).toBeVisible();
  260 |   expect(await tableRows.count()).toBeGreaterThan(0);
  261 |   await expect(page.getByText(/travellersautobarn/i)).toBeVisible();
  262 | });
  263 | 
```