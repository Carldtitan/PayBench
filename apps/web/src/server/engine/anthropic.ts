import "./server-only";

import { createHash } from "node:crypto";
import {
  changePlanSchema,
  lockedFactsSchema,
  paywallSpecSchema,
  type ChangePlan,
  type PaywallSpec,
} from "@paybench/contracts";
import { validateChangePlan, validatePaywallSpec } from "../../../../../packages/paywall/src";

export interface CapturedPageEvidence {
  source_url: string;
  source_hash: string;
  desktop_screenshot_path: string;
  mobile_screenshot_path: string;
  reduced_dom: string;
  visible_text: string;
  brand_tokens: Record<string, string | number>;
}

export interface PaywallModelAdapter {
  extractPaywallSpec(evidence: CapturedPageEvidence): Promise<PaywallSpec>;
  createChangePlan(spec: PaywallSpec): Promise<ChangePlan>;
}

export type AnthropicTransport = (url: string, init: RequestInit) => Promise<Response>;

interface AnthropicOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  transport?: AnthropicTransport;
}

const lockedFactsJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["product_name", "product_details", "price_display", "billing_terms", "legal_text", "claims", "trial_terms", "guarantee_terms"],
  properties: {
    product_name: { type: "string", minLength: 1, maxLength: 2000 },
    product_details: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1, maxLength: 2000 } },
    price_display: { type: "string", minLength: 1, maxLength: 2000 },
    billing_terms: { type: "array", minItems: 1, maxItems: 12, items: { type: "string", minLength: 1, maxLength: 2000 } },
    legal_text: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1, maxLength: 2000 } },
    claims: { type: "array", maxItems: 30, items: { type: "string", minLength: 1, maxLength: 2000 } },
    trial_terms: { type: "array", maxItems: 10, items: { type: "string", minLength: 1, maxLength: 2000 } },
    guarantee_terms: { type: "array", maxItems: 10, items: { type: "string", minLength: 1, maxLength: 2000 } },
  },
} as const;

const paywallDraftJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["brand", "locked_facts", "headline", "supporting_copy", "primary_action_label"],
  properties: {
    brand: {
      type: "object",
      additionalProperties: false,
      required: ["name", "primary_color", "accent_color", "surface_color", "text_color", "font_family"],
      properties: {
        name: { type: "string", minLength: 1, maxLength: 100 },
        logo_url: { type: "string", format: "uri" },
        primary_color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        accent_color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        surface_color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        text_color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        font_family: { type: "string", minLength: 1, maxLength: 120 },
      },
    },
    locked_facts: lockedFactsJsonSchema,
    headline: { type: "string", minLength: 1, maxLength: 240 },
    supporting_copy: { type: "array", minItems: 1, maxItems: 6, items: { type: "string", minLength: 1, maxLength: 240 } },
    primary_action_label: { type: "string", minLength: 1, maxLength: 80 },
  },
} as const;

const changePlanDraftJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["hypothesis", "operation"],
  properties: {
    hypothesis: { type: "string", minLength: 12, maxLength: 300 },
    operation: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "target_component_id", "value"],
      properties: {
        kind: { enum: ["replace_headline", "replace_primary_action_label", "reorder_benefits", "set_default_plan", "change_trust_emphasis"] },
        target_component_id: { type: "string", pattern: "^[a-z][a-z0-9_-]{2,63}$" },
        value: { anyOf: [{ type: "string", minLength: 1, maxLength: 240 }, { type: "array", minItems: 1, maxItems: 12, items: { type: "string", minLength: 1, maxLength: 240 } }] },
      },
    },
  },
} as const;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

const UNSUPPORTED_WIRE_CONSTRAINTS = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "pattern",
  "format",
]);

/** Anthropic constrains shape; the stricter local schemas enforce all limits. */
function anthropicWireSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(anthropicWireSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !UNSUPPORTED_WIRE_CONSTRAINTS.has(key))
      .map(([key, child]) => [key, anthropicWireSchema(child)]),
  );
}

function sourceSupportedText(value: unknown, allowed: readonly string[], fallback: string): string {
  return typeof value === "string" && allowed.includes(value.trim()) ? value.trim() : fallback;
}

function sourceSupportedList(value: unknown, allowed: readonly string[], fallback: readonly string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const safe = value.filter((item): item is string => typeof item === "string" && allowed.includes(item.trim()));
  return safe.length > 0 ? [...new Set(safe.map((item) => item.trim()))] : [...fallback];
}

function buildControlTree(draft: Record<string, unknown>, locked: ReturnType<typeof lockedFactsSchema.parse>): PaywallSpec["tree"] {
  const supported = [locked.product_name, ...locked.product_details, ...locked.claims];
  const headline = sourceSupportedText(draft.headline, supported, locked.product_name);
  const supportingCopy = sourceSupportedList(draft.supporting_copy, supported, locked.product_details);
  const action = typeof draft.primary_action_label === "string" &&
    /^(?:continue|review|choose|select|see|open|start|complete|next|view)\b/i.test(draft.primary_action_label) &&
    !/\b(?:free|trial|guarantee|discount|save|secure|best|risk-free)\b|[\u0024\u20ac\u00a3\u00a5]|\d/.test(draft.primary_action_label)
    ? draft.primary_action_label.trim()
    : "Continue";
  const trust = locked.claims.length > 0 ? locked.claims : locked.product_details;
  const legal = [...locked.legal_text, ...locked.trial_terms, ...locked.guarantee_terms];
  return {
    id: "paywall-shell",
    type: "PaywallShell",
    props: { layout: "single" },
    children: [
      { id: "brand-header", type: "BrandHeader", props: { name: (draft.brand as Record<string, unknown>)?.name }, children: [] },
      { id: "offer-summary", type: "OfferSummary", props: { headline, supporting_copy: supportingCopy, product_name: locked.product_name, price_display: locked.price_display, billing_terms: locked.billing_terms }, children: [] },
      { id: "plan-selector", type: "PlanSelector", props: { plans: [{ id: "source-plan", name: locked.product_name, price_display: locked.price_display, billing_terms: locked.billing_terms }], default_plan_id: "source-plan" }, children: [] },
      { id: "benefit-list", type: "BenefitList", props: { items: locked.product_details }, children: [] },
      { id: "trust-panel", type: "TrustPanel", props: { items: trust }, children: [] },
      { id: "checkout-form", type: "CheckoutForm", props: { fake_customer_name: "Alex Example", fake_billing_address: "00000", fake_payment_token: "SIMULATED-PAYMENT", required_acknowledgement: "I understand this is a simulation and no money will be charged." }, children: [] },
      { id: "order-summary", type: "OrderSummary", props: { title: "Order review" }, children: [] },
      { id: "primary-action", type: "PrimaryAction", props: { label: action }, children: [] },
      { id: "legal-footer", type: "LegalFooter", props: { items: legal }, children: [] },
      { id: "simulation-notice", type: "SimulationNotice", props: { message: "Simulation only. No charge, account, or subscription will be created.", simulated_budget: "$100 simulated money" }, children: [] },
    ],
  };
}

function extractText(response: unknown): string {
  if (!response || typeof response !== "object") throw new Error("ANTHROPIC_RESPONSE_INVALID");
  const content = (response as { content?: unknown }).content;
  if (!Array.isArray(content)) throw new Error("ANTHROPIC_RESPONSE_INVALID");
  const text = content.find((block) => block && typeof block === "object" && (block as { type?: unknown }).type === "text") as { text?: unknown } | undefined;
  if (!text || typeof text.text !== "string") throw new Error("ANTHROPIC_RESPONSE_INVALID");
  return text.text;
}

export class AnthropicStructuredOutputAdapter implements PaywallModelAdapter {
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly transport: AnthropicTransport;

  constructor(private readonly options: AnthropicOptions) {
    if (!options.apiKey) throw new Error("ANTHROPIC_API_KEY_MISSING");
    this.model = options.model ?? "claude-sonnet-4-5";
    this.baseUrl = options.baseUrl ?? "https://api.anthropic.com/v1/messages";
    this.transport = options.transport ?? fetch;
  }

  private async structured(prompt: string, _name: string, schema: object): Promise<unknown> {
    const response = await this.transport(this.baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": this.options.apiKey,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 8_000,
        system: "Return only the requested structured object. Never emit HTML, JavaScript, CSS, event handlers, scripts, trackers, invented claims, or altered commercial facts.",
        messages: [{ role: "user", content: prompt }],
        output_config: {
          format: {
            type: "json_schema",
            schema: anthropicWireSchema(schema),
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`ANTHROPIC_REQUEST_FAILED_${response.status}`);
    return JSON.parse(extractText(await response.json())) as unknown;
  }

  async extractPaywallSpec(evidence: CapturedPageEvidence): Promise<PaywallSpec> {
    if (!/^[a-f0-9]{64}$/.test(evidence.source_hash)) throw new Error("CAPTURE_SOURCE_HASH_INVALID");
    const source = new URL(evidence.source_url);
    if (!/^https?:$/.test(source.protocol)) throw new Error("CAPTURE_SOURCE_URL_INVALID");
    if (evidence.reduced_dom.length > 200_000 || evidence.visible_text.length > 100_000) {
      throw new Error("CAPTURE_EVIDENCE_TOO_LARGE");
    }
    if (Object.keys(evidence.brand_tokens).length > 200) throw new Error("CAPTURE_BRAND_TOKENS_TOO_LARGE");
    const draft = await this.structured(
      `Extract a structured paywall draft from this measured capture. Copy commercial facts exactly; never invent a claim, price, term, trial, guarantee, or product detail. product_details, billing_terms, and legal_text must each contain at least one exact source string. claims, trial_terms, and guarantee_terms may be empty when the source does not state them. The headline and every supporting-copy item must each be an exact string from the extracted product name, product details, or claims. Evidence:\n${JSON.stringify(evidence)}`,
      "paywall_spec_draft",
      paywallDraftJsonSchema,
    ) as Record<string, unknown>;
    const locked = lockedFactsSchema.parse(draft.locked_facts);
    return validatePaywallSpec(paywallSpecSchema.parse({
      contract_version: "2",
      source_url: evidence.source_url,
      brand: draft.brand,
      locked_facts: locked,
      tree: buildControlTree(draft, locked),
      source_hash: evidence.source_hash,
      locked_facts_hash: sha256(locked),
    }));
  }

  async createChangePlan(specInput: PaywallSpec): Promise<ChangePlan> {
    const spec = validatePaywallSpec(specInput);
    const draft = await this.structured(
      `Choose one constrained improvement for this PaywallSpec. Return exactly one allow-listed operation against an existing component ID. Do not add or remove components and do not change locked facts. PaywallSpec:\n${JSON.stringify(spec)}`,
      "change_plan_draft",
      changePlanDraftJsonSchema,
    ) as Record<string, unknown>;
    return validateChangePlan(changePlanSchema.parse({
      contract_version: "2",
      hypothesis: draft.hypothesis,
      operation: draft.operation,
      source_spec_hash: spec.source_hash,
      locked_facts_hash: spec.locked_facts_hash,
    }));
  }
}

export class MockPaywallModelAdapter implements PaywallModelAdapter {
  constructor(
    private readonly spec: PaywallSpec,
    private readonly plan: ChangePlan,
  ) {}

  async extractPaywallSpec(): Promise<PaywallSpec> {
    return structuredClone(validatePaywallSpec(this.spec));
  }

  async createChangePlan(spec: PaywallSpec): Promise<ChangePlan> {
    const parsed = validateChangePlan(this.plan);
    if (parsed.source_spec_hash !== spec.source_hash) throw new Error("MOCK_CHANGE_PLAN_SPEC_MISMATCH");
    return structuredClone(parsed);
  }
}
