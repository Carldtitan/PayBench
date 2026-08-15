import type { ChangePlan, PaywallSpec } from "@paybench/contracts";

export const PAYWALL_SOURCE_HASH = "a".repeat(64);
export const LOCKED_FACTS_HASH = "b".repeat(64);

export const paywallFixture: PaywallSpec = {
  contract_version: "2",
  source_url: "https://northstar.example/pricing",
  source_hash: PAYWALL_SOURCE_HASH,
  locked_facts_hash: LOCKED_FACTS_HASH,
  brand: {
    name: "Northstar",
    primary_color: "#125f7a",
    accent_color: "#e4a320",
    surface_color: "#f8fbfc",
    text_color: "#16333d",
    font_family: "Recursive",
  },
  locked_facts: {
    product_name: "Northstar Growth",
    product_details: ["For startup teams"],
    price_display: "$29 / month",
    billing_terms: ["Billed monthly"],
    legal_text: ["Terms apply."],
    claims: ["Ship faster"],
    trial_terms: ["No trial"],
    guarantee_terms: ["Cancel anytime"],
  },
  tree: {
    id: "paywall-root",
    type: "PaywallShell",
    props: { layout: "split" },
    children: [
      { id: "brand-header", type: "BrandHeader", props: { name: "Northstar" }, children: [] },
      {
        id: "offer-summary",
        type: "OfferSummary",
        props: {
          headline: "For startup teams",
          supporting_copy: ["For startup teams"],
          product_name: "Northstar Growth",
          price_display: "$29 / month",
          billing_terms: ["Billed monthly"],
        },
        children: [],
      },
      {
        id: "plan-selector",
        type: "PlanSelector",
        props: {
          plans: [{ id: "growth", name: "Growth", price_display: "$29 / month", billing_terms: ["Billed monthly"] }],
          default_plan_id: "growth",
        },
        children: [],
      },
      { id: "benefit-list", type: "BenefitList", props: { items: ["Ship faster"] }, children: [] },
      { id: "trust-panel", type: "TrustPanel", props: { items: ["No trial", "Cancel anytime"] }, children: [] },
      {
        id: "checkout-form",
        type: "CheckoutForm",
        props: {
          fake_customer_name: "Taylor Example",
          fake_billing_address: "100 Test Street",
          fake_payment_token: "SIMULATED-TOKEN",
          required_acknowledgement: "Use the supplied simulated details",
        },
        children: [],
      },
      { id: "order-summary", type: "OrderSummary", props: { title: "Review" }, children: [] },
      { id: "primary-action", type: "PrimaryAction", props: { label: "Continue" }, children: [] },
      { id: "legal-footer", type: "LegalFooter", props: { items: ["Terms apply."] }, children: [] },
      {
        id: "simulation-notice",
        type: "SimulationNotice",
        props: { message: "No charge will occur.", simulated_budget: "$100 simulated" },
        children: [],
      },
    ],
  },
};

export const changePlanFixture: ChangePlan = {
  contract_version: "2",
  hypothesis: "A clearer action label reduces hesitation at the next step.",
  source_spec_hash: PAYWALL_SOURCE_HASH,
  locked_facts_hash: LOCKED_FACTS_HASH,
  operation: {
    kind: "replace_primary_action_label",
    target_component_id: "primary-action",
    value: "Review simulated order",
  },
};

