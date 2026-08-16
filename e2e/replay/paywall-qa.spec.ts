import { expect, test, type Page } from "@playwright/test";

const controlUrl = process.env.REPLAY_CONTROL_URL;
const challengerUrl = process.env.REPLAY_CHALLENGER_URL;
const authorization = process.env.REPLAY_QA_AUTHORIZATION;

async function openPreview(page: Page, url: string, mobile = false) {
  if (authorization) await page.setExtraHTTPHeaders({ authorization });
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 });
  await page.goto(url, { waitUntil: "networkidle" });
  await expect(page.locator(".pb-paywall")).toBeVisible();
  await expect(page.locator('input[name*="card" i], input[name*="cvv" i], input[name*="expiry" i]')).toHaveCount(0);
}

async function completePurchase(page: Page) {
  const firstPlan = page.locator('input[name="simulated-plan"]').first();
  await expect(firstPlan).toBeVisible();
  await firstPlan.check();
  await page.locator(".pb-primary-action").click();
  await expect(page.getByRole("heading", { name: "Simulated checkout" })).toBeVisible();
  await page.locator('.pb-checkout input[type="checkbox"]').check();
  await page.locator(".pb-primary-action").click();
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
  await page.locator(".pb-primary-action").click();
  const survey = page.locator("form.pb-survey");
  await expect(survey).toBeVisible();
  expect(await survey.evaluate((form) => (form as HTMLFormElement).checkValidity())).toBe(false);
  await survey.locator('textarea[name="understood_offer"]').fill("A paid software plan.");
  await survey.locator('textarea[name="understood_price_terms"]').fill("The displayed price and billing terms.");
  await survey.locator('textarea[name="hesitation"]').fill("I wanted clearer proof.");
  await survey.locator('select[name="clarity_score"]').selectOption("4");
  await survey.locator('select[name="trust_score"]').selectOption("4");
  await survey.locator('input[name="would_continue"][value="yes"]').check();
  await survey.locator('textarea[name="continuation_reason"]').fill("The offer was clear enough.");
  await survey.getByRole("button", { name: "Finish" }).click();
  await expect(page.locator(".pb-complete")).toBeVisible();
}

for (const [label, url] of [["control", controlUrl], ["challenger", challengerUrl]] as const) {
  test.describe(label, () => {
    test.skip(!url, `REPLAY_${label.toUpperCase()}_URL is required`);

    test("desktop purchase, validation, survey, and payment safety", async ({ page }) => {
      await openPreview(page, url!);
      await completePurchase(page);
    });

    test("mobile purchase journey", async ({ page }) => {
      await openPreview(page, url!, true);
      await completePurchase(page);
    });

    test("stopping receives the same survey", async ({ page }) => {
      await openPreview(page, url!);
      await page.getByRole("button", { name: "I would stop here" }).click();
      await expect(page.getByRole("heading", { name: "Quick questions" })).toBeVisible();
    });
  });
}
