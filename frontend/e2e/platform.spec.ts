import { expect, test, type Page, type TestInfo } from "@playwright/test";

async function signIn(page: Page, role: "Generation" | "Marketplace" | "Administration") {
  await page.goto("/");
  await page.getByRole("button", { name: role, exact: true }).click();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function checkLayout(page: Page, testInfo: TestInfo, name: string) {
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
  if (process.env.UCS_SCREENSHOTS === "true") {
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
  }
}

test("generator views hourly data and forecast, then creates and cancels a listing", async ({ page }, testInfo) => {
  await signIn(page, "Generation");
  await expect(page.getByRole("heading", { name: "Generation dashboard" })).toBeVisible();
  await expect(page.locator(".recharts-area-curve")).toHaveCount(3);
  await expect(page.getByText("Surya rooftop array", { exact: true })).toBeVisible();
  await expect(page.getByText(/MAE 3.28 kWh vs 6.95 kWh/)).toBeVisible();
  await page.mouse.move(0, 0);
  await checkLayout(page, testInfo, "generator");

  await page.getByRole("button", { name: "Create listing" }).click();
  const create = page.getByRole("dialog", { name: "Create listing" });
  await create.getByLabel("Amount (kgCO₂e)").fill("25");
  await create.getByLabel("Price per kg (₹)").fill("9.75");
  await create.getByRole("button", { name: "Create listing" }).click();
  await expect(page.getByText("Listing created. Its units are now reserved.")).toBeVisible();
  const listing = page.locator(".listing-list li").filter({ hasText: "₹9.75" });
  await expect(listing).toContainText("25 kgCO₂e");
  await listing.getByRole("button", { name: "Cancel listing" }).click();
  await page.getByRole("dialog", { name: "Cancel listing?" }).getByRole("button", { name: "Cancel listing" }).click();
  await expect(listing).toContainText("cancelled");
});

test("buyer settles a purchase, opens its details, and checks both verification outcomes", async ({ page }, testInfo) => {
  await signIn(page, "Marketplace");
  await expect(page.getByRole("heading", { name: "Carbon marketplace" })).toBeVisible();
  const buys = page.getByRole("button", { name: "Buy units" });
  await expect(buys).toHaveCount(3);
  await checkLayout(page, testInfo, "buyer");

  await buys.first().click();
  const dialog = page.getByRole("dialog", { name: "Buy carbon units" });
  await dialog.getByLabel("Amount (kgCO₂e)").fill("20.125");
  await expect(dialog.getByText("₹85.53", { exact: true })).toBeVisible();
  await checkLayout(page, testInfo, "purchase");
  await dialog.getByRole("button", { name: "Confirm purchase" }).click();
  await expect(page.getByText("Purchase settled.", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "View trade" }).click();
  await expect(page.getByRole("heading", { name: "Trade TRD-105" })).toBeVisible();
  await expect(page.getByText("20.125 kgCO₂e", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Back to workspace" }).click();
  const matches = page.locator(".trade-row").filter({ hasText: "TRD-101" });
  await matches.getByRole("link", { name: "Purchase TRD-101" }).click();
  await expect(page.getByRole("heading", { name: "Trade TRD-101" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sepolia explorer" })).toHaveAttribute("href", /^https:\/\/sepolia\.etherscan\.io\/tx\/0x[\da-f]{64}$/);
  await page.getByRole("button", { name: "Verify on-chain" }).click();
  await expect(page.getByText("Match", { exact: true })).toBeVisible();
  await checkLayout(page, testInfo, "trade-detail");

  await page.getByRole("link", { name: "Back to workspace" }).click();
  const mismatches = page.locator(".trade-row").filter({ hasText: "TRD-104" });
  await mismatches.getByRole("button", { name: "Verify on-chain" }).click();
  await expect(mismatches.getByText("Mismatch", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Carbon marketplace" })).toBeVisible();
});

test("admin provisions and revokes a device, retries an anchor, and adds a factor", async ({ page }, testInfo) => {
  await signIn(page, "Administration");
  await expect(page.getByRole("heading", { name: "Platform administration" })).toBeVisible();
  await expect(page.getByText(/Low wallet balance/)).toBeVisible();
  await expect(page.getByText("Interval exceeds rated capacity")).toBeVisible();
  await checkLayout(page, testInfo, "admin");

  await page.getByRole("button", { name: "Provision device" }).click();
  const provision = page.getByRole("dialog");
  await provision.getByLabel("Device label").fill("Demo inverter");
  await provision.getByLabel("Organisation ID").fill("org-surya");
  await provision.getByLabel("Rated capacity (kW)").fill("25");
  await provision.getByRole("button", { name: "Provision device" }).click();
  await expect(provision.getByLabel("Device secret")).toHaveValue(/^demo-/);
  await provision.getByRole("button", { name: "Done" }).click();

  const device = page.locator(".listing-list li").filter({ hasText: "Demo inverter" });
  await device.getByRole("button", { name: "Revoke" }).click();
  await page.getByRole("dialog", { name: "Revoke device?" }).getByRole("button", { name: "Revoke device" }).click();
  await expect(device).toContainText("revoked");

  await page.getByRole("button", { name: "Retry anchor" }).click();
  await expect(page.getByText("Anchor retry queued.")).toBeVisible();

  await page.getByRole("button", { name: "Add version" }).click();
  const factor = page.getByRole("dialog", { name: "Add emission factor" });
  await factor.getByLabel("Version").fill("Demo-v21");
  await factor.getByLabel("Emission factor (kgCO₂e/kWh)").fill("0.7");
  await factor.getByLabel("Source").fill("Demo publication");
  await factor.getByLabel("Valid from").fill("2026-12-01");
  await factor.getByRole("button", { name: "Save factor" }).click();
  await expect(page.getByText("Demo-v21", { exact: true })).toBeVisible();
});

test("login and all legacy on-chain pages render at this viewport", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await checkLayout(page, testInfo, "login");

  await page.getByRole("link", { name: "On-chain tools" }).click();
  await expect(page).toHaveURL(/\/on-chain$/);
  await expect(page.getByRole("button", { name: "Connect Wallet" }).first()).toBeVisible();
  await checkLayout(page, testInfo, "on-chain");

  for (const [link, path] of [["Market", "marketplace"], ["Projects", "projects"], ["My credits", "portfolio"]]) {
    await page.getByRole("link", { name: link, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/on-chain/${path}$`));
    await expect(page.getByText("No deployment found", { exact: false })).toBeVisible();
    await checkLayout(page, testInfo, `on-chain-${path}`);
  }

  for (const path of ["projects/1", "admin"]) {
    await page.goto(`/on-chain/${path}`);
    await expect(page.getByText("No deployment found", { exact: false })).toBeVisible();
    await checkLayout(page, testInfo, `on-chain-${path.replace("/", "-")}`);
  }

  await page.getByRole("link", { name: "Platform", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
