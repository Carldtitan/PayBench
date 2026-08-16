import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeRoot = "apps/web/app/demo/linear";
const runnerPath = "apps/web/components/linear-demo-run.tsx";
const paywallPath = "apps/web/components/linear-paywall-demo.tsx";

describe("public Linear demo", () => {
  it("is linked from the founder surface and renders an explicit Run control", () => {
    const founder = readFileSync("apps/web/components/founder-intake.tsx", "utf8");
    const runner = readFileSync(runnerPath, "utf8");

    expect(founder).toMatch(/href=["']\/demo\/linear["']/);
    expect(existsSync(`${routeRoot}/page.tsx`)).toBe(true);
    expect(runner).toContain("<button");
    expect(runner).toContain('"Run Linear test"');
  });

  it("provides distinct links for page A and page B", () => {
    const runner = readFileSync(runnerPath, "utf8");

    expect(runner).toMatch(/href=["']\/demo\/linear\/a["']/);
    expect(runner).toMatch(/href=["']\/demo\/linear\/b["']/);
  });

  it("keeps the posted Terac sequence inside the sample-run context", () => {
    const runner = readFileSync(runnerPath, "utf8");

    expect(runner).toMatch(/Terac/i);
    expect(runner).toContain("Sample run");
    expect(runner).toContain("Terac pilot posted");
  });

  it("never renders real payment credential inputs", () => {
    const runner = readFileSync(runnerPath, "utf8");
    const paywall = readFileSync(paywallPath, "utf8");
    const source = `${runner}\n${paywall}`;
    const inputTags = [...source.matchAll(/<input\b[^>]*>/gi)]
      .map((match) => match[0])
      .join("\n");

    expect(inputTags).not.toMatch(
      /(?:name|id|autoComplete|placeholder)\s*=\s*["'][^"']*(?:card|cvv|cvc|expir(?:y|ation))[^"']*["']/i,
    );
    expect(source).toMatch(/simulat|fake|no (?:charge|money)/i);
  });
});
