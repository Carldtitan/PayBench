import { expect, test, type Page } from "@playwright/test";

const controlUrl = process.env.REPLAY_CONTROL_URL;
const challengerUrl = process.env.REPLAY_CHALLENGER_URL;
const authorization = process.env.REPLAY_QA_AUTHORIZATION;
const studyUrl = process.env.REPLAY_QA_STUDY_URL;

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
  const prefix = label === "control" ? "a" : "b";
  test.describe(label, () => {
    test.skip(!url, `REPLAY_${label.toUpperCase()}_URL is required`);

    test(`${prefix}_desktop_purchase + ${prefix}_form_validation + ${prefix}_survey_submission`, async ({ page }) => {
      await openPreview(page, url!);
      await completePurchase(page);
    });

    test(`${prefix}_mobile_purchase`, async ({ page }) => {
      await openPreview(page, url!, true);
      await completePurchase(page);
    });

    test(`${prefix}_desktop_stop`, async ({ page }) => {
      await openPreview(page, url!);
      await page.getByRole("button", { name: "I would stop here" }).click();
      await expect(page.getByRole("heading", { name: "Quick questions" })).toBeVisible();
    });
  });
}

test("assignment_refresh_persistence", async ({ page }) => {
  test.skip(!studyUrl, "REPLAY_QA_STUDY_URL is required and must not consume a participant slot");
  await page.goto(studyUrl!, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Decide as you normally would." })).toBeVisible();
  const cookiesBefore = await page.context().cookies();
  const sessionBefore = cookiesBefore.find((cookie) => cookie.name === "paybench_participant");
  expect(sessionBefore?.httpOnly).toBe(true);
  await page.reload({ waitUntil: "networkidle" });
  const sessionAfter = (await page.context().cookies()).find((cookie) => cookie.name === "paybench_participant");
  expect(sessionAfter?.value).toBe(sessionBefore?.value);
  expect(page.url()).not.toMatch(/[?&](variant|assignment|studyId)=/i);
});

test("mocked_terac_redirect", async ({ page }) => {
  test.skip(!studyUrl, "REPLAY_QA_STUDY_URL is required and must not consume a participant slot");
  const url = new URL(studyUrl!);
  url.searchParams.set("teracSubmissionId", `replay-${Date.now()}`);
  await page.goto(url.toString(), { waitUntil: "networkidle" });
  await page.getByLabel("I match this description.").check();
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Review order" }).click();
  await page.getByRole("button", { name: "Complete simulated purchase" }).click();
  const answers = page.locator("textarea");
  for (let index = 0; index < 4; index += 1) await answers.nth(index).fill("Clear simulated purchase feedback.");
  await page.getByLabel("Offer clarity").selectOption("4");
  await page.getByLabel("Page trust").selectOption("4");
  await page.getByRole("button", { name: "Finish task" }).click();
  await expect(page).toHaveURL(/\/s\/complete\?receipt=/);
});
