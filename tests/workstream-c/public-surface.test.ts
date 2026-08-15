import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const participant = readFileSync(
  "apps/web/components/participant/participant-experience.tsx",
  "utf8",
);
const studyServer = readFileSync("apps/web/src/server/study/repository.ts", "utf8");
const publicImplementation = `${participant}\n${studyServer}`;

describe("public participant surface", () => {
  it("never renders or asks for real payment credentials", () => {
    expect(publicImplementation).toContain("Alex Example");
    expect(publicImplementation).toContain("00000");
    expect(publicImplementation).toContain("SIMULATION TOKEN");
    expect(participant).not.toMatch(/type=["'](?:tel|password)["']/i);
    expect(participant).not.toMatch(/card number|security code|\bcvv\b|\bcvc\b|expiry|expiration/i);
  });

  it("contains no Terac transport or launch operation", () => {
    expect(studyServer).not.toMatch(/fetch\s*\(/);
    expect(studyServer).not.toMatch(/\b(?:createJob|upload|publish|launch)\s*\(/i);
    expect(studyServer).toContain('terac_mode: "mock"');
    expect(studyServer).toContain('terac_actions: ["copy_brief", "copy_study_link"]');
  });
});
