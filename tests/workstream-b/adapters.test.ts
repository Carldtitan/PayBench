import { describe, expect, it } from "vitest";
import { AnthropicStructuredOutputAdapter } from "../../apps/web/src/server/engine/anthropic";
import {
  SuperserveCaptureAdapter,
  SuperserveWorkSurfaceAdapter,
  type CapturePlanBuilder,
  type SuperserveSandboxFactory,
  type SuperserveSandboxInstance,
} from "../../apps/web/src/server/engine/superserve";
import { SAFE_CAPTURE_LIMITS } from "../../apps/web/src/server/engine/capture";
import { changePlanFixture, paywallFixture } from "./fixtures";

describe("Anthropic structured output", () => {
  it("uses output_config.format with a strict JSON schema and validates the result", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const draft = {
      brand: paywallFixture.brand,
      locked_facts: paywallFixture.locked_facts,
      tree: paywallFixture.tree,
    };
    const adapter = new AnthropicStructuredOutputAdapter({
      apiKey: "test-key",
      transport: async (_url, init) => {
        requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Response.json({ content: [{ type: "text", text: JSON.stringify(draft) }] });
      },
    });
    const result = await adapter.extractPaywallSpec({
      source_url: paywallFixture.source_url,
      source_hash: paywallFixture.source_hash,
      desktop_screenshot_path: "jobs/demo/capture/desktop.png",
      mobile_screenshot_path: "jobs/demo/capture/mobile.png",
      reduced_dom: "main > section > h1",
      visible_text: "Northstar Growth $29 / month",
      brand_tokens: { primary: "#125f7a" },
    });
    const outputConfig = requestBody?.output_config as { format?: { type?: unknown; strict?: unknown } };
    expect(outputConfig.format).toMatchObject({ type: "json_schema", strict: true });
    expect(result.tree.type).toBe("PaywallShell");
    expect(result.locked_facts_hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("Superserve operator work surfaces", () => {
  it("creates two private sandboxes and returns only signed operator previews", async () => {
    const createOptions: Array<Record<string, unknown>> = [];
    const files: string[] = [];
    const makeSandbox = (id: string): SuperserveSandboxInstance => ({
      id,
      files: { async write(path) { files.push(path); } },
      commands: {
        async spawn() { return { async kill() {} }; },
        async run() { return { stdout: "", stderr: "", exitCode: 0 }; },
      },
      async getInfo() { return { id, status: "active" }; },
      async publishPreviewPort(port, options) { expect(port).toBe(4173); expect(options.access).toBe("private"); },
      async getSignedPreviewUrl() { return `https://preview.example/${id}?signed=1`; },
      async pause() {},
      async kill() {},
    });
    let index = 0;
    const factory: SuperserveSandboxFactory = {
      async create(options) {
        createOptions.push(options);
        index += 1;
        return makeSandbox(`00000000-0000-4000-8000-00000000000${index}`);
      },
    };
    const adapter = new SuperserveWorkSurfaceAdapter(factory, () => new Date("2026-08-15T20:00:00.000Z"));
    const result = await adapter.open({
      jobId: "63ca958e-3ad5-4f07-9f76-950da5587a1a",
      operatorAuthorized: true,
      sourceUrl: paywallFixture.source_url,
      control: paywallFixture,
      challenger: { ...paywallFixture, tree: structuredClone(paywallFixture.tree) },
    });
    expect(result.map((surface) => surface.variant)).toEqual(["A", "B"]);
    expect(result.every((surface) => surface.operator_only && surface.preview_url?.startsWith("https://"))).toBe(true);
    expect(createOptions.every((options) => options.previewAccess === "private")).toBe(true);
    expect(files.filter((path) => path.endsWith("variant.json"))).toHaveLength(2);
    expect(files.every((path) => path.startsWith("/workspace/paybench/"))).toBe(true);
  });

  it("rejects calls without explicit operator authorization", async () => {
    const adapter = new SuperserveWorkSurfaceAdapter({ async create() { throw new Error("not reached"); } });
    await expect(adapter.open({
      jobId: "63ca958e-3ad5-4f07-9f76-950da5587a1a",
      operatorAuthorized: false as true,
      sourceUrl: paywallFixture.source_url,
      control: paywallFixture,
      challenger: paywallFixture,
    })).rejects.toThrow("OPERATOR_ACCESS_REQUIRED");
  });
});

describe("Superserve source capture", () => {
  const sourceUrl = "https://example.com/";
  const buildPlan: CapturePlanBuilder = async () => ({
    sourceUrl,
    limits: SAFE_CAPTURE_LIMITS,
    captures: ["desktop_screenshot", "mobile_screenshot", "reduced_dom", "visible_text", "brand_tokens"],
    browserRules: {
      blockDownloads: true,
      blockPopups: true,
      blockPermissions: true,
      blockExternalProtocols: true,
      stopBeforeAccountTrialOrderOrCharge: true,
      executeSourceScriptsInSandbox: true,
      copySourceScriptsToGeneratedPage: false,
    },
  });

  function captureSandbox(result: { exitCode: number; stderr?: string }) {
    const writes: string[] = [];
    const commands: string[] = [];
    let paused = false;
    let killed = false;
    const sandbox: SuperserveSandboxInstance = {
      id: "00000000-0000-4000-8000-000000000009",
      files: {
        async write(path) { writes.push(path); },
        async readText() {
          return JSON.stringify({
            source_url: sourceUrl,
            source_hash: "a".repeat(64),
            desktop_screenshot_path: "/workspace/paybench/desktop.png",
            mobile_screenshot_path: "/workspace/paybench/mobile.png",
            reduced_dom: "<html><body>Example</body></html>",
            visible_text: "Example",
            brand_tokens: { title: "Example" },
          });
        },
      },
      commands: {
        async spawn() { return { async kill() {} }; },
        async run(command) {
          commands.push(command);
          return { stdout: "", stderr: result.stderr ?? "", exitCode: result.exitCode };
        },
      },
      async getInfo() { return { id: this.id, status: "active" }; },
      async publishPreviewPort() {},
      async getSignedPreviewUrl() { return "https://preview.example/private"; },
      async pause() { paused = true; },
      async kill() { killed = true; },
    };
    return { sandbox, writes, commands, state: () => ({ paused, killed }) };
  }

  it("boots the configured browser template and runs the Node Playwright capture", async () => {
    const fake = captureSandbox({ exitCode: 0 });
    let createOptions: Parameters<SuperserveSandboxFactory["create"]>[0] | undefined;
    const factory: SuperserveSandboxFactory = {
      async create(options) {
        createOptions = options;
        return fake.sandbox;
      },
    };
    const adapter = new SuperserveCaptureAdapter(factory, { template: "paybench-browser" }, buildPlan);
    const evidence = await adapter.capture("63ca958e-3ad5-4f07-9f76-950da5587a1a", sourceUrl);

    expect(createOptions).toMatchObject({ fromTemplate: "paybench-browser", previewAccess: "private" });
    expect(fake.writes).toContain("/workspace/paybench/capture.mjs");
    expect(fake.commands).toEqual(["node /workspace/paybench/capture.mjs"]);
    expect(fake.state()).toEqual({ paused: true, killed: false });
    expect(evidence.source_hash).toBe("a".repeat(64));
  });

  it("fails before sandbox creation when the browser template is not configured", async () => {
    let createCalls = 0;
    const adapter = new SuperserveCaptureAdapter({
      async create() {
        createCalls += 1;
        throw new Error("not reached");
      },
    }, { template: " " }, buildPlan);

    await expect(adapter.capture("63ca958e-3ad5-4f07-9f76-950da5587a1a", sourceUrl))
      .rejects.toThrow("SUPERSERVE_TEMPLATE_REQUIRED");
    expect(createCalls).toBe(0);
  });

  it("surfaces a known Playwright failure code and kills the sandbox", async () => {
    const fake = captureSandbox({
      exitCode: 1,
      stderr: "PAYBENCH_CAPTURE_ERROR:SUPERSERVE_PLAYWRIGHT_UNAVAILABLE\n",
    });
    const adapter = new SuperserveCaptureAdapter({
      async create() { return fake.sandbox; },
    }, { template: "paybench-browser" }, buildPlan);

    await expect(adapter.capture("63ca958e-3ad5-4f07-9f76-950da5587a1a", sourceUrl))
      .rejects.toThrow("SUPERSERVE_PLAYWRIGHT_UNAVAILABLE");
    expect(fake.state()).toEqual({ paused: false, killed: true });
  });
});
