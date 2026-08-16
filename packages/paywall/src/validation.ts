import {
  changePlanSchema,
  paywallSpecSchema,
  type ChangePlan,
  type PaywallNode,
  type PaywallSpec,
} from "@paybench/contracts";

const ALLOWED_PROPS = {
  PaywallShell: new Set(["layout"]),
  BrandHeader: new Set(["name"]),
  OfferSummary: new Set([
    "headline",
    "supporting_copy",
    "product_name",
    "price_display",
    "billing_terms",
  ]),
  PlanSelector: new Set(["plans", "default_plan_id"]),
  BenefitList: new Set(["items"]),
  TrustPanel: new Set(["items", "emphasized_item"]),
  CheckoutForm: new Set([
    "fake_customer_name",
    "fake_billing_address",
    "fake_payment_token",
    "required_acknowledgement",
  ]),
  OrderSummary: new Set(["title"]),
  PrimaryAction: new Set(["label"]),
  LegalFooter: new Set(["items"]),
  SimulationNotice: new Set(["message", "simulated_budget"]),
} satisfies Record<PaywallNode["type"], ReadonlySet<string>>;

const REQUIRED_COMPONENTS: readonly PaywallNode["type"][] = [
  "PaywallShell",
  "BrandHeader",
  "OfferSummary",
  "PlanSelector",
  "CheckoutForm",
  "OrderSummary",
  "PrimaryAction",
  "LegalFooter",
  "SimulationNotice",
];

const EXECUTABLE_TEXT = /<\/?[a-z]|javascript:|data\s*:\s*text\/html|@import|expression\s*\(|url\s*\(/i;
const FORBIDDEN_PROP_KEY = /^(?:on[a-z]|style|css|html|markup|script|srcdoc|dangerouslysetinnerhtml|tracker|tracking|analytics)$/i;

export class PaywallValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PaywallValidationError";
  }
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PaywallValidationError("PAYWALL_PROP_INVALID", `${label} must be a non-empty string`);
  }
  return value;
}

function expectStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string" && item.trim())) {
    throw new PaywallValidationError("PAYWALL_PROP_INVALID", `${label} must be a non-empty string array`);
  }
  return value;
}

function expectOptionalStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim())) {
    throw new PaywallValidationError("PAYWALL_PROP_INVALID", `${label} must be a string array`);
  }
  return value;
}

function validatePlans(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw new PaywallValidationError("PAYWALL_PLAN_INVALID", "PlanSelector requires one to eight plans");
  }

  const ids = new Set<string>();
  for (const plan of value) {
    if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
      throw new PaywallValidationError("PAYWALL_PLAN_INVALID", "Every plan must be an object");
    }
    const record = plan as Record<string, unknown>;
    const allowed = new Set(["id", "name", "price_display", "billing_terms", "product_details", "claims"]);
    if (Object.keys(record).some((key) => !allowed.has(key))) {
      throw new PaywallValidationError("PAYWALL_PLAN_PROP_FORBIDDEN", "A plan contains an unsupported property");
    }
    const id = expectString(record.id, "plan.id");
    expectString(record.name, "plan.name");
    expectString(record.price_display, "plan.price_display");
    if (record.billing_terms !== undefined) expectOptionalStringArray(record.billing_terms, "plan.billing_terms");
    if (record.product_details !== undefined) expectOptionalStringArray(record.product_details, "plan.product_details");
    if (record.claims !== undefined) expectOptionalStringArray(record.claims, "plan.claims");
    if (!/^[a-z][a-z0-9_-]{1,39}$/.test(id) || ids.has(id)) {
      throw new PaywallValidationError("PAYWALL_PLAN_ID_INVALID", "Plan IDs must be unique safe identifiers");
    }
    ids.add(id);
  }
}

function scanValue(value: unknown, key = "value"): void {
  if (FORBIDDEN_PROP_KEY.test(key)) {
    throw new PaywallValidationError("PAYWALL_PROP_FORBIDDEN", `Property ${key} is forbidden`);
  }
  if (typeof value === "string" && EXECUTABLE_TEXT.test(value)) {
    throw new PaywallValidationError("PAYWALL_EXECUTABLE_CONTENT", "HTML, JavaScript, CSS, and resource loaders are forbidden");
  }
  if (Array.isArray(value)) {
    value.forEach((item) => scanValue(item));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([childKey, child]) => scanValue(child, childKey));
  }
}

function validateNodeProps(node: PaywallNode): void {
  const allowed = ALLOWED_PROPS[node.type];
  for (const [key, value] of Object.entries(node.props)) {
    if (!allowed.has(key) || FORBIDDEN_PROP_KEY.test(key)) {
      throw new PaywallValidationError("PAYWALL_PROP_FORBIDDEN", `${node.type}.${key} is not allowed`);
    }
    scanValue(value, key);
  }

  switch (node.type) {
    case "PaywallShell":
      if (node.props.layout !== undefined && !["single", "split"].includes(String(node.props.layout))) {
        throw new PaywallValidationError("PAYWALL_PROP_INVALID", "PaywallShell.layout must be single or split");
      }
      break;
    case "BrandHeader":
      expectString(node.props.name, "BrandHeader.name");
      break;
    case "OfferSummary":
      expectString(node.props.headline, "OfferSummary.headline");
      expectString(node.props.product_name, "OfferSummary.product_name");
      expectString(node.props.price_display, "OfferSummary.price_display");
      if (node.props.supporting_copy !== undefined) expectStringArray(node.props.supporting_copy, "OfferSummary.supporting_copy");
      if (node.props.billing_terms !== undefined) expectStringArray(node.props.billing_terms, "OfferSummary.billing_terms");
      break;
    case "PlanSelector":
      validatePlans(node.props.plans);
      if (node.props.default_plan_id !== undefined) expectString(node.props.default_plan_id, "PlanSelector.default_plan_id");
      break;
    case "BenefitList":
    case "TrustPanel":
    case "LegalFooter":
      expectStringArray(node.props.items, `${node.type}.items`);
      if (node.type === "TrustPanel" && node.props.emphasized_item !== undefined) {
        const emphasis = expectString(node.props.emphasized_item, "TrustPanel.emphasized_item");
        if (!expectStringArray(node.props.items, "TrustPanel.items").includes(emphasis)) {
          throw new PaywallValidationError("PAYWALL_TRUST_INVALID", "Trust emphasis must reference an existing trust item");
        }
      }
      break;
    case "CheckoutForm":
      expectString(node.props.fake_customer_name, "CheckoutForm.fake_customer_name");
      expectString(node.props.fake_billing_address, "CheckoutForm.fake_billing_address");
      expectString(node.props.fake_payment_token, "CheckoutForm.fake_payment_token");
      expectString(node.props.required_acknowledgement, "CheckoutForm.required_acknowledgement");
      break;
    case "OrderSummary":
      if (node.props.title !== undefined) expectString(node.props.title, "OrderSummary.title");
      break;
    case "PrimaryAction":
      expectString(node.props.label, "PrimaryAction.label");
      break;
    case "SimulationNotice":
      expectString(node.props.message, "SimulationNotice.message");
      expectString(node.props.simulated_budget, "SimulationNotice.simulated_budget");
      break;
  }
}

export function walkPaywallTree(tree: PaywallNode): PaywallNode[] {
  const output: PaywallNode[] = [];
  const visit = (node: PaywallNode, depth: number) => {
    if (depth > 12) throw new PaywallValidationError("PAYWALL_TREE_TOO_DEEP", "Paywall tree exceeds twelve levels");
    output.push(node);
    if (output.length > 120) throw new PaywallValidationError("PAYWALL_TREE_TOO_LARGE", "Paywall tree exceeds 120 components");
    node.children.forEach((child) => visit(child, depth + 1));
  };
  visit(tree, 0);
  return output;
}

export function findPaywallNode(tree: PaywallNode, id: string): PaywallNode | undefined {
  return walkPaywallTree(tree).find((node) => node.id === id);
}

function treeText(tree: PaywallNode): Set<string> {
  const values = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      values.add(value.trim());
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(visit);
    }
  };
  walkPaywallTree(tree).forEach((node) => visit(node.props));
  return values;
}

export function validatePaywallSpec(input: unknown): PaywallSpec {
  const parsed = paywallSpecSchema.safeParse(input);
  if (!parsed.success) {
    throw new PaywallValidationError("PAYWALL_SCHEMA_INVALID", parsed.error.issues[0]?.message ?? "PaywallSpec is invalid");
  }
  const spec = parsed.data;
  const nodes = walkPaywallTree(spec.tree);

  for (const node of nodes) {
    if (node !== spec.tree && node.type === "PaywallShell") {
      throw new PaywallValidationError("PAYWALL_ROOT_NESTED", "PaywallShell can appear only at the root");
    }
    validateNodeProps(node);
  }

  const present = new Set(nodes.map((node) => node.type));
  const missing = REQUIRED_COMPONENTS.filter((type) => !present.has(type));
  if (missing.length > 0) {
    throw new PaywallValidationError("PAYWALL_COMPONENT_MISSING", `Required components missing: ${missing.join(", ")}`);
  }

  const values = treeText(spec.tree);
  const locked = spec.locked_facts;
  const requiredText = [
    locked.product_name,
    locked.price_display,
    ...locked.product_details,
    ...locked.billing_terms,
    ...locked.legal_text,
    ...locked.claims,
    ...locked.trial_terms,
    ...locked.guarantee_terms,
    ...(locked.source_plans ?? []).flatMap((plan) => [
      plan.name,
      plan.price_display,
      ...plan.billing_terms,
      ...plan.product_details,
      ...plan.claims,
    ]),
  ];
  const omitted = requiredText.filter((value) => !values.has(value.trim()));
  if (omitted.length > 0) {
    throw new PaywallValidationError("LOCKED_FACT_MISSING", `Locked source text is missing from the component tree: ${omitted[0]}`);
  }


  if (locked.source_plans) {
    const selector = nodes.find((node) => node.type === "PlanSelector");
    const renderedPlans = selector?.props.plans;
    if (!Array.isArray(renderedPlans) || JSON.stringify(renderedPlans) !== JSON.stringify(locked.source_plans)) {
      throw new PaywallValidationError(
        "LOCKED_PLANS_CHANGED",
        "PlanSelector must reproduce every captured plan and its locked commercial facts exactly",
      );
    }
  }

  return spec;
}

export function validateChangePlan(input: unknown): ChangePlan {
  const parsed = changePlanSchema.safeParse(input);
  if (!parsed.success) {
    throw new PaywallValidationError("CHANGE_PLAN_SCHEMA_INVALID", parsed.error.issues[0]?.message ?? "ChangePlan is invalid");
  }
  const plan = parsed.data;
  scanValue(plan.operation.value);
  return plan;
}

export function paywallTopology(tree: PaywallNode): string {
  return JSON.stringify({
    id: tree.id,
    type: tree.type,
    children: tree.children.map(paywallTopology),
  });
}
