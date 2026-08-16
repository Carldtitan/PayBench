import "./server-only";

import { createHash } from "node:crypto";
import {
  changePlanSchema,
  lockedFactsSchema,
  paywallSpecSchema,
  type ChangePlan,
  type LockedFacts,
  type LockedPlan,
  type PaywallSpec,
} from "@paybench/contracts";
import { buildPaywallVariants, validateChangePlan, validatePaywallSpec } from "../../../../../packages/paywall/src";

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
  required: ["product_name", "product_details", "price_display", "billing_terms", "legal_text", "claims", "trial_terms", "guarantee_terms", "source_plans"],
  properties: {
    product_name: { type: "string", minLength: 1, maxLength: 2000 },
    product_details: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1, maxLength: 2000 } },
    price_display: { type: "string", minLength: 1, maxLength: 2000 },
    billing_terms: { type: "array", minItems: 1, maxItems: 12, items: { type: "string", minLength: 1, maxLength: 2000 } },
    legal_text: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1, maxLength: 2000 } },
    claims: { type: "array", maxItems: 30, items: { type: "string", minLength: 1, maxLength: 2000 } },
    trial_terms: { type: "array", maxItems: 10, items: { type: "string", minLength: 1, maxLength: 2000 } },
    guarantee_terms: { type: "array", maxItems: 10, items: { type: "string", minLength: 1, maxLength: 2000 } },
    source_plans: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "price_display", "billing_terms", "product_details", "claims"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 2000 },
          price_display: { type: "string", minLength: 1, maxLength: 2000 },
          billing_terms: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 2000 } },
          product_details: { type: "array", maxItems: 16, items: { type: "string", minLength: 1, maxLength: 2000 } },
          claims: { type: "array", maxItems: 12, items: { type: "string", minLength: 1, maxLength: 2000 } },
        },
      },
    },
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

function evidenceLines(evidence: CapturedPageEvidence): string[] {
  return [...new Set(evidence.visible_text
    .split(/\r?\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 1 && line.length <= 2_000))]
    .slice(0, 800);
}

function normalizeSourceText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}

function sourceCorpus(evidence: CapturedPageEvidence): string {
  const title = typeof evidence.brand_tokens.title === "string" ? evidence.brand_tokens.title : "";
  return normalizeSourceText(`${title}\n${evidence.visible_text}`);
}

function isSourceSupported(value: unknown, evidence: CapturedPageEvidence): value is string {
  if (typeof value !== "string") return false;
  const normalized = normalizeSourceText(value);
  return normalized.length > 0 && sourceCorpus(evidence).includes(normalized);
}

function sourceSupportedItems(value: unknown, evidence: CapturedPageEvidence, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => isSourceSupported(item, evidence))
    .map((item) => item.replace(/\s+/g, " ").trim()))]
    .slice(0, limit);
}

function collapseRepeatedPrice(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length % 2 === 0) {
    const half = trimmed.slice(0, trimmed.length / 2);
    if (half === trimmed.slice(trimmed.length / 2)) return half;
  }
  return trimmed;
}

function safePlanId(name: string, used: Set<string>): string {
  const base = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "plan";
  let candidate = /^[a-z]/.test(base) ? base : `plan-${base}`;
  if (candidate.length < 2) candidate = `${candidate}-plan`;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base.slice(0, 28)}-${suffix++}`;
  used.add(candidate);
  return candidate;
}

function isPriceLine(line: string): boolean {
  return /[$€£¥]\s*\d|\d[\d,.]*\s*(?:usd|eur|gbp)\b/i.test(line) || /^custom$/i.test(line);
}

function isPlanNameCandidate(line: string): boolean {
  return line.length <= 80 &&
    !isPriceLine(line) &&
    !/^(?:pricing|plans?|monthly|yearly|annual|most popular|recommended|input|button|get started|contact sales)$/i.test(line) &&
    !/\b(?:billed|billing|per user|per month|per year)\b/i.test(line);
}

/** Deterministically recovers pricing cards when model output is missing or incomplete. */
export function extractSourcePlans(evidence: CapturedPageEvidence): LockedPlan[] {
  const lines = evidenceLines(evidence);
  const candidates: Array<{ nameIndex: number; priceIndex: number }> = [];
  for (let priceIndex = 0; priceIndex < lines.length && candidates.length < 8; priceIndex += 1) {
    if (!isPriceLine(lines[priceIndex]!)) continue;
    let nameIndex = priceIndex - 1;
    while (nameIndex >= Math.max(0, priceIndex - 4) && !isPlanNameCandidate(lines[nameIndex]!)) nameIndex -= 1;
    if (nameIndex >= 0) candidates.push({ nameIndex, priceIndex });
  }

  const usedIds = new Set<string>();
  const seen = new Set<string>();
  const plans: LockedPlan[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    const name = lines[candidate.nameIndex]!;
    const priceDisplay = collapseRepeatedPrice(lines[candidate.priceIndex]!);
    const key = `${normalizeSourceText(name)}\u0000${normalizeSourceText(priceDisplay)}`;
    if (seen.has(key) || !isSourceSupported(priceDisplay, evidence)) continue;
    seen.add(key);
    const stop = candidates[index + 1]?.nameIndex ?? Math.min(lines.length, candidate.priceIndex + 20);
    const rawBlock = lines.slice(candidate.priceIndex + 1, stop);
    const actionIndex = rawBlock.findIndex((line) => /^(?:get started|contact sales|choose|select)(?:\s|$)/i.test(line));
    const block = actionIndex >= 0 ? rawBlock.slice(0, actionIndex) : rawBlock;
    const billingTerms = block.filter((line) => /\b(?:bill(?:ed|ing)?|month(?:ly)?|year(?:ly)?|annual(?:ly)?|one[- ]time)\b/i.test(line)).slice(0, 8);
    const productDetails = block.filter((line) =>
      !isPriceLine(line) &&
      !billingTerms.includes(line) &&
      !/^(?:input|button|get started|contact sales|learn more|choose|select)$/i.test(line) &&
      !/^(?:terms|privacy|cookies?|legal)$/i.test(line),
    ).slice(0, 16);
    plans.push({
      id: safePlanId(name, usedIds),
      name,
      price_display: priceDisplay,
      billing_terms: billingTerms,
      product_details: productDetails,
      claims: [],
    });
  }
  return plans;
}

function mergeSourcePlans(draft: Record<string, unknown>, evidence: CapturedPageEvidence): LockedPlan[] {
  const draftLocked = draft.locked_facts && typeof draft.locked_facts === "object"
    ? draft.locked_facts as Record<string, unknown>
    : {};
  const draftPlans = Array.isArray(draftLocked.source_plans) ? draftLocked.source_plans : [];
  const safeDraftPlans = draftPlans.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const plan = value as Record<string, unknown>;
    if (!isSourceSupported(plan.name, evidence) || !isSourceSupported(plan.price_display, evidence)) return [];
    return [{
      name: plan.name.replace(/\s+/g, " ").trim(),
      price_display: collapseRepeatedPrice(plan.price_display.replace(/\s+/g, " ").trim()),
      billing_terms: sourceSupportedItems(plan.billing_terms, evidence, 8),
      product_details: sourceSupportedItems(plan.product_details, evidence, 16),
      claims: sourceSupportedItems(plan.claims, evidence, 12),
    }];
  });
  const inferred = extractSourcePlans(evidence);
  const ordered = inferred.map((plan) => {
    const modelPlan = safeDraftPlans.find((item) =>
      normalizeSourceText(item.name) === normalizeSourceText(plan.name) &&
      normalizeSourceText(item.price_display) === normalizeSourceText(plan.price_display));
    return modelPlan ? {
      ...plan,
      billing_terms: [...new Set([...modelPlan.billing_terms, ...plan.billing_terms])].slice(0, 8),
      product_details: [...new Set([...modelPlan.product_details, ...plan.product_details])].slice(0, 16),
      claims: modelPlan.claims,
    } : plan;
  });
  const usedIds = new Set(ordered.map((plan) => plan.id));
  for (const plan of safeDraftPlans) {
    if (ordered.some((item) => normalizeSourceText(item.name) === normalizeSourceText(plan.name))) continue;
    ordered.push({ id: safePlanId(plan.name, usedIds), ...plan });
  }
  if (ordered.length > 0) return ordered.slice(0, 8);

  const lines = evidenceLines(evidence);
  const name = isSourceSupported(draftLocked.product_name, evidence)
    ? draftLocked.product_name.trim()
    : lines.find(isPlanNameCandidate) ?? new URL(evidence.source_url).hostname.replace(/^www\./, "");
  const price = isSourceSupported(draftLocked.price_display, evidence)
    ? collapseRepeatedPrice(draftLocked.price_display.trim())
    : collapseRepeatedPrice(lines.find(isPriceLine) ?? name);
  return [{
    id: safePlanId(name, new Set()),
    name,
    price_display: price,
    billing_terms: sourceSupportedItems(draftLocked.billing_terms, evidence, 8),
    product_details: sourceSupportedItems(draftLocked.product_details, evidence, 16),
    claims: sourceSupportedItems(draftLocked.claims, evidence, 12),
  }];
}

function capturedBrandName(evidence: CapturedPageEvidence): string {
  const title = typeof evidence.brand_tokens.title === "string" ? evidence.brand_tokens.title.trim() : "";
  const titleParts = title.split(/\s+[–—|:]\s+/).filter(Boolean);
  const titleName = titleParts.length > 1 && /^(?:pricing|plans?)$/i.test(titleParts[0]!) ? titleParts.at(-1) : titleParts[0];
  const hostname = new URL(evidence.source_url).hostname.replace(/^www\./, "").split(".")[0] ?? "Product";
  const raw = titleName && titleName.length <= 100 ? titleName : hostname;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function capturedColor(evidence: CapturedPageEvidence, index: number, fallback: string): string {
  const flat: unknown[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach(visit);
    else flat.push(value);
  };
  visit(evidence.brand_tokens);
  const colors = flat.flatMap((value) => {
    if (typeof value !== "string") return [];
    if (/^#[0-9a-fA-F]{6}$/.test(value)) return [value];
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value);
    return rgb ? [`#${rgb.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`] : [];
  });
  return colors[index] ?? fallback;
}

function sanitizeLockedFacts(draft: Record<string, unknown>, evidence: CapturedPageEvidence): LockedFacts {
  const raw = draft.locked_facts && typeof draft.locked_facts === "object"
    ? draft.locked_facts as Record<string, unknown>
    : {};
  const sourcePlans = mergeSourcePlans(draft, evidence);
  const planDetails = sourcePlans.flatMap((plan) => plan.product_details);
  const planBilling = sourcePlans.flatMap((plan) => plan.billing_terms);
  const productDetails = [...new Set([...sourceSupportedItems(raw.product_details, evidence, 20), ...planDetails])].slice(0, 20);
  const billingTerms = [...new Set([...sourceSupportedItems(raw.billing_terms, evidence, 12), ...planBilling])].slice(0, 12);
  const lines = evidenceLines(evidence);
  const legalFromSource = lines.filter((line) => /\b(?:terms|privacy|cancel|refund|legal|agreement)\b/i.test(line)).slice(0, 20);
  const legalText = [...new Set([...sourceSupportedItems(raw.legal_text, evidence, 20), ...legalFromSource])].slice(0, 20);
  const productName = isSourceSupported(raw.product_name, evidence) ? raw.product_name.trim() : capturedBrandName(evidence);
  const priceDisplay = sourcePlans[0]!.price_display;
  return lockedFactsSchema.parse({
    product_name: productName,
    product_details: productDetails.length > 0 ? productDetails : sourcePlans.map((plan) => plan.name),
    price_display: priceDisplay,
    billing_terms: billingTerms.length > 0 ? billingTerms : [priceDisplay],
    legal_text: legalText.length > 0 ? legalText : [billingTerms[0] ?? priceDisplay],
    claims: sourceSupportedItems(raw.claims, evidence, 30),
    trial_terms: sourceSupportedItems(raw.trial_terms, evidence, 10),
    guarantee_terms: sourceSupportedItems(raw.guarantee_terms, evidence, 10),
    source_plans: sourcePlans,
  });
}

function sanitizeBrand(draft: Record<string, unknown>, evidence: CapturedPageEvidence) {
  const raw = draft.brand && typeof draft.brand === "object" ? draft.brand as Record<string, unknown> : {};
  const safeHex = (value: unknown, fallback: string) => typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value
    : fallback;
  const capturedFont = typeof evidence.brand_tokens.font_family === "string" && evidence.brand_tokens.font_family.trim()
    ? evidence.brand_tokens.font_family.trim().slice(0, 120)
    : undefined;
  return {
    name: isSourceSupported(raw.name, evidence) ? raw.name.trim().slice(0, 100) : capturedBrandName(evidence),
    primary_color: capturedColor(evidence, 0, safeHex(raw.primary_color, "#171717")),
    accent_color: capturedColor(evidence, 1, safeHex(raw.accent_color, "#5E6AD2")),
    surface_color: capturedColor(evidence, 2, safeHex(raw.surface_color, "#F7F7F8")),
    text_color: capturedColor(evidence, 3, safeHex(raw.text_color, "#171717")),
    font_family: capturedFont ?? (typeof raw.font_family === "string" && raw.font_family.trim() ? raw.font_family.trim().slice(0, 120) : "system-ui"),
  };
}

function buildFallbackPaywallSpec(evidence: CapturedPageEvidence): PaywallSpec {
  const productName = capturedBrandName(evidence);
  const locked = sanitizeLockedFacts({ locked_facts: { product_name: productName } }, evidence);
  const brand = sanitizeBrand({}, evidence);
  return validatePaywallSpec(paywallSpecSchema.parse({
    contract_version: "2",
    source_url: evidence.source_url,
    brand,
    locked_facts: locked,
    tree: buildControlTree({ brand, headline: productName, supporting_copy: locked.product_details, primary_action_label: "Continue" }, locked),
    source_hash: evidence.source_hash,
    locked_facts_hash: sha256(locked),
  }));
}

/** Safe local continuation when a provider returns structurally invalid JSON. */
export function createFallbackPaywallSpec(evidence: CapturedPageEvidence): PaywallSpec {
  return buildFallbackPaywallSpec(evidence);
}

export function createFallbackChangePlan(specInput: PaywallSpec): ChangePlan {
  const spec = validatePaywallSpec(specInput);
  const trustItem = spec.locked_facts.claims[0] ?? spec.locked_facts.product_details[0]!;
  return validateChangePlan(changePlanSchema.parse({
    contract_version: "2",
    hypothesis: "Emphasizing existing source proof may reduce hesitation without changing the offer.",
    operation: { kind: "change_trust_emphasis", target_component_id: "trust-panel", value: trustItem },
    source_spec_hash: spec.source_hash,
    locked_facts_hash: spec.locked_facts_hash,
  }));
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
  const plans = locked.source_plans ?? [{
    id: "source-plan",
    name: locked.product_name,
    price_display: locked.price_display,
    billing_terms: locked.billing_terms,
    product_details: locked.product_details,
    claims: locked.claims,
  }];
  return {
    id: "paywall-shell",
    type: "PaywallShell",
    props: { layout: "single" },
    children: [
      { id: "brand-header", type: "BrandHeader", props: { name: (draft.brand as Record<string, unknown>)?.name }, children: [] },
      { id: "offer-summary", type: "OfferSummary", props: { headline, supporting_copy: supportingCopy, product_name: locked.product_name, price_display: locked.price_display, billing_terms: locked.billing_terms }, children: [] },
      { id: "plan-selector", type: "PlanSelector", props: { plans, default_plan_id: plans[0]!.id }, children: [] },
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
      `Extract a structured paywall draft from this measured capture. Capture every distinct source pricing card in source_plans, in source order. Copy each plan name, displayed price, billing term, product detail, and claim verbatim from visible_text. Do not combine plans. Never invent a claim, price, term, trial, guarantee, or product detail. claims, trial_terms, and guarantee_terms must be empty when the source does not state them. Headline and supporting-copy items must be exact source strings. Evidence:\n${JSON.stringify(evidence)}`,
      "paywall_spec_draft",
      paywallDraftJsonSchema,
    ) as Record<string, unknown>;
    const locked = sanitizeLockedFacts(draft, evidence);
    const brand = sanitizeBrand(draft, evidence);
    return validatePaywallSpec(paywallSpecSchema.parse({
      contract_version: "2",
      source_url: evidence.source_url,
      brand,
      locked_facts: locked,
      tree: buildControlTree({ ...draft, brand }, locked),
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
    const plan = validateChangePlan(changePlanSchema.parse({
      contract_version: "2",
      hypothesis: draft.hypothesis,
      operation: draft.operation,
      source_spec_hash: spec.source_hash,
      locked_facts_hash: spec.locked_facts_hash,
    }));
    // Apply once before returning. This rejects a model-selected value that is
    // not already present in source-supported A, even when its JSON is valid.
    buildPaywallVariants(spec, plan);
    return plan;
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
