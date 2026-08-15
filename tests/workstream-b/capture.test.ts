import { describe, expect, it } from "vitest";
import {
  CaptureSafetyError,
  createCaptureEvidencePlan,
  validateCaptureRedirectChain,
  validatePublicCaptureUrl,
  type HostResolver,
} from "../../apps/web/src/server/engine/capture";

const publicResolver: HostResolver = { async resolve() { return ["93.184.216.34"]; } };

describe("safe capture plan", () => {
  it("creates bounded desktop, mobile, DOM, text, and token capture work", async () => {
    const plan = await createCaptureEvidencePlan("https://example.com/pricing", publicResolver);
    expect(plan.limits.maxRedirects).toBe(5);
    expect(plan.limits.maxResponseBytes).toBe(20 * 1024 * 1024);
    expect(plan.captures).toEqual(["desktop_screenshot", "mobile_screenshot", "reduced_dom", "visible_text", "brand_tokens"]);
    expect(plan.browserRules.executeSourceScriptsInSandbox).toBe(true);
    expect(plan.browserRules.copySourceScriptsToGeneratedPage).toBe(false);
  });

  it.each([
    "http://127.0.0.1",
    "http://2130706433",
    "http://[::1]",
    "http://169.254.169.254/latest/meta-data",
    "file:///etc/passwd",
    "https://user:pass@example.com",
  ])("blocks unsafe target %s", async (target) => {
    await expect(validatePublicCaptureUrl(target, publicResolver)).rejects.toBeInstanceOf(CaptureSafetyError);
  });

  it("rejects public DNS that resolves to a private address", async () => {
    await expect(validatePublicCaptureUrl("https://example.com", { async resolve() { return ["10.0.0.5"]; } })).rejects.toMatchObject({ code: "URL_NETWORK_BLOCKED" });
  });

  it("validates every redirect and enforces the redirect limit", async () => {
    await expect(validateCaptureRedirectChain(["https://example.com", "http://127.0.0.1"], publicResolver)).rejects.toMatchObject({ code: "URL_NETWORK_BLOCKED" });
    await expect(validateCaptureRedirectChain(Array.from({ length: 7 }, (_, index) => `https://example.com/${index}`), publicResolver)).rejects.toMatchObject({ code: "REDIRECT_LIMIT" });
  });
});
