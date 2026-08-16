import { describe, expect, it } from "vitest";
import {
  AnthropicStructuredOutputAdapter,
  createFallbackPaywallSpec,
  extractSourcePlans,
} from "../../apps/web/src/server/engine/anthropic";
import {
  SANDBOX_CLIENT_SOURCE,
  SANDBOX_SERVER_SOURCE,
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
      headline: paywallFixture.locked_facts.product_name,
      supporting_copy: paywallFixture.locked_facts.product_details,
      primary_action_label: "Continue",
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
    const outputConfig = requestBody?.output_config as {
      format?: {
        type?: unknown;
        strict?: unknown;
        schema?: unknown;
      };
    };
    expect(outputConfig.format).toMatchObject({ type: "json_schema" });
    expect(JSON.stringify(outputConfig.format?.schema)).not.toMatch(/\$defs|"maxItems"|"maxLength"|"pattern"|"format"/);
    expect(result.tree.type).toBe("PaywallShell");
    expect(result.locked_facts_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  const linearEvidence = {
    source_url: "https://linear.app/pricing",
    source_hash: "d".repeat(64),
    desktop_screenshot_path: "jobs/linear/capture/desktop.png",
    mobile_screenshot_path: "jobs/linear/capture/mobile.png",
    reduced_dom: "<main><h1>Pricing</h1></main>",
    visible_text: [
      "Pricing",
      "Free",
      "$0",
      "Free for everyone",
      "Unlimited members",
      "2 teams",
      "250 issues",
      "Basic",
      "$10 per user/month$10 per user/month",
      "Billed yearly",
      "All Free features +",
      "5 teams",
      "Unlimited issues",
      "Business",
      "$16 per user/month$16 per user/month",
      "Billed yearly",
      "All Basic features +",
      "Unlimited teams",
      "Private teams and guests",
      "Enterprise",
      "Custom",
      "Annual billing only",
      "All Business features +",
      "SAML and SCIM",
      "Contact sales",
      "Trusted by more than 40,000 companies",
      "Privacy",
      "Terms",
    ].join("\n"),
    brand_tokens: {
      title: "Pricing – Linear",
      colors: ["rgb(31, 32, 35)", "rgb(94, 106, 210)", "rgb(247, 248, 248)"],
      font_family: "Inter Variable, sans-serif",
    },
  };

  it("recovers every Linear pricing card instead of collapsing to one generic plan", () => {
    const plans = extractSourcePlans(linearEvidence);
    expect(plans.map((plan) => [plan.name, plan.price_display])).toEqual([
      ["Free", "$0"],
      ["Basic", "$10 per user/month"],
      ["Business", "$16 per user/month"],
      ["Enterprise", "Custom"],
    ]);

    const spec = createFallbackPaywallSpec(linearEvidence);
    const selector = spec.tree.children.find((node) => node.type === "PlanSelector");
    expect(selector?.props.plans).toEqual(spec.locked_facts.source_plans);
    expect(spec.locked_facts.source_plans).toHaveLength(4);
    expect(spec.brand.name).toBe("Linear");
  });

  it("drops invented model facts and keeps every exact source plan", async () => {
    const draft = {
      brand: {
        name: "Linear",
        primary_color: "#1f2023",
        accent_color: "#5e6ad2",
        surface_color: "#f7f8f8",
        text_color: "#1f2023",
        font_family: "Inter Variable, sans-serif",
      },
      locked_facts: {
        product_name: "Linear",
        product_details: ["Unlimited members", "Invented AI superpower"],
        price_display: "$0",
        billing_terms: ["Billed yearly", "50% discount forever"],
        legal_text: ["Privacy", "Lifetime guarantee"],
        claims: ["Trusted by more than 40,000 companies", "Best app on earth"],
        trial_terms: [],
        guarantee_terms: ["Lifetime guarantee"],
        source_plans: [
          { name: "Free", price_display: "$0", billing_terms: [], product_details: ["Unlimited members"], claims: [] },
          { name: "Basic", price_display: "$10 per user/month", billing_terms: ["Billed yearly"], product_details: ["5 teams"], claims: [] },
          { name: "Business", price_display: "$16 per user/month", billing_terms: ["Billed yearly"], product_details: ["Unlimited teams"], claims: [] },
          { name: "Enterprise", price_display: "Custom", billing_terms: ["Annual billing only"], product_details: ["SAML and SCIM"], claims: [] },
        ],
      },
      headline: "Linear",
      supporting_copy: ["Unlimited members", "Invented AI superpower"],
      primary_action_label: "Continue",
    };
    const adapter = new AnthropicStructuredOutputAdapter({
      apiKey: "test-key",
      transport: async () => Response.json({ content: [{ type: "text", text: JSON.stringify(draft) }] }),
    });
    const spec = await adapter.extractPaywallSpec(linearEvidence);
    expect(spec.locked_facts.source_plans?.map((plan) => plan.name)).toEqual(["Free", "Basic", "Business", "Enterprise"]);
    expect(JSON.stringify(spec)).not.toContain("Invented AI superpower");
    expect(JSON.stringify(spec)).not.toContain("50% discount forever");
    expect(JSON.stringify(spec)).not.toContain("Lifetime guarantee");
    expect(JSON.stringify(spec)).not.toContain("Best app on earth");
  });

  it("rejects a syntactically valid B change that is not source-supported", async () => {
    const adapter = new AnthropicStructuredOutputAdapter({
      apiKey: "test-key",
      transport: async () => Response.json({
        content: [{
          type: "text",
          text: JSON.stringify({
            hypothesis: "An invented promise could influence conversion but is not permitted.",
            operation: {
              kind: "replace_headline",
              target_component_id: "offer-summary",
              value: "Guaranteed to double productivity",
            },
          }),
        }],
      }),
    });
    await expect(adapter.createChangePlan(paywallFixture)).rejects.toThrow(/source-supported/);
  });
});

describe("Superserve operator work surfaces", () => {
  const surfaceOptions = {
    template: "paybench-browser",
    previewPort: 4173,
    previewExpirySeconds: 3_600,
    timeoutSeconds: 3_600,
    autoDeleteSeconds: 86_400,
  };

  it("creates two private sandboxes and returns only signed operator previews", async () => {
    const createOptions: Array<Record<string, unknown>> = [];
    const files: string[] = [];
    const commands: string[] = [];
    const makeSandbox = (id: string): SuperserveSandboxInstance => ({
      id,
      files: { async write(path) { files.push(path); } },
      commands: {
        async spawn(command) { commands.push(command); return { async kill() {} }; },
        async run(command) {
          commands.push(command);
          return { stdout: command.includes("nohup") ? "123\n" : "", stderr: "", exitCode: 0 };
        },
      },
      async getInfo() { return { id, status: "active" }; },
      async publishPreviewPort(port, options) {
        expect(port).toBe(4173);
        expect(options.access).toBe("private");
        return { port, access: "private" };
      },
      async getSignedPreviewUrl(_port, options) {
        expect(options.expiresInSeconds).toBe(3_600);
        return `https://preview.example/${id}?superserve_preview_token=signed`;
      },
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
    const adapter = new SuperserveWorkSurfaceAdapter(
      factory,
      () => new Date("2026-08-15T20:00:00.000Z"),
      surfaceOptions,
    );
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
    expect(createOptions.every((options) => options.fromTemplate === "paybench-browser")).toBe(true);
    expect(files.filter((path) => path.endsWith("variant.json"))).toHaveLength(2);
    expect(files.every((path) => path.startsWith("/workspace/paybench/"))).toBe(true);
    expect(commands.filter((command) => command.includes("setTimeout(check,250)")).length).toBe(2);
    expect(commands.filter((command) => command.includes("nohup env PAYBENCH_PREVIEW_PORT=4173")).length).toBe(2);
  });

  it("serves the complete fixed-code simulated journey without payment fields", () => {
    expect(SANDBOX_SERVER_SOURCE).toContain('data-testid="plan-selector"');
    expect(SANDBOX_SERVER_SOURCE).toContain('data-testid="fake-checkout"');
    expect(SANDBOX_SERVER_SOURCE).toContain('data-testid="order-review"');
    expect(SANDBOX_SERVER_SOURCE).toContain('data-testid="simulate-purchase"');
    expect(SANDBOX_SERVER_SOURCE).toContain('data-testid="stop-action"');
    expect(SANDBOX_SERVER_SOURCE).toContain('data-testid="participant-survey"');
    expect(SANDBOX_SERVER_SOURCE).toContain('data-testid="completion"');
    expect(SANDBOX_SERVER_SOURCE).toContain('data-testid="mock-completion-redirect"');
    expect(SANDBOX_SERVER_SOURCE).toContain('data-testid="mock-completion-received"');
    expect(SANDBOX_CLIENT_SOURCE).toContain('askForSurvey("continue")');
    expect(SANDBOX_CLIENT_SOURCE).toContain('askForSurvey("stop")');
    expect(SANDBOX_SERVER_SOURCE).not.toMatch(/card.?number|cvv|cvc|expiry/i);
    expect(SANDBOX_SERVER_SOURCE).not.toContain("https://");
  });

  it("rejects calls without explicit operator authorization", async () => {
    const adapter = new SuperserveWorkSurfaceAdapter(
      { async create() { throw new Error("not reached"); } },
      undefined,
      surfaceOptions,
    );
    await expect(adapter.open({
      jobId: "63ca958e-3ad5-4f07-9f76-950da5587a1a",
      operatorAuthorized: false as true,
      sourceUrl: paywallFixture.source_url,
      control: paywallFixture,
      challenger: paywallFixture,
    })).rejects.toThrow("OPERATOR_ACCESS_REQUIRED");
  });

  it("requires the browser template before creating any preview sandbox", async () => {
    let created = false;
    const adapter = new SuperserveWorkSurfaceAdapter(
      { async create() { created = true; throw new Error("not reached"); } },
      undefined,
      { ...surfaceOptions, template: " " },
    );

    await expect(adapter.open({
      jobId: "63ca958e-3ad5-4f07-9f76-950da5587a1a",
      operatorAuthorized: true,
      sourceUrl: paywallFixture.source_url,
      control: paywallFixture,
      challenger: paywallFixture,
    })).rejects.toThrow("SUPERSERVE_TEMPLATE_REQUIRED");
    expect(created).toBe(false);
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
      async publishPreviewPort(port) { return { port, access: "private" }; },
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
    expect(fake.commands).toEqual([
      "node /workspace/paybench/capture.mjs",
      "test -s /workspace/paybench/desktop.png && test -s /workspace/paybench/mobile.png && test -s /workspace/paybench/capture.json",
    ]);
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
