import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PaywallRegistryView,
  PaywallValidationError,
  buildPaywallVariants,
  createPaywallInteraction,
  paywallTopology,
  reducePaywallInteraction,
  validatePaywallSpec,
} from "../../packages/paywall/src";
import { changePlanFixture, paywallFixture } from "./fixtures";

describe("paywall registry", () => {
  it("builds A from the spec and B from exactly one property change", () => {
    const built = buildPaywallVariants(paywallFixture, changePlanFixture);
    expect(paywallTopology(built.control.tree)).toBe(paywallTopology(built.challenger.tree));
    expect(built.challenger.locked_facts).toEqual(built.control.locked_facts);
    expect(built.changedComponentId).toBe("primary-action");
    expect(built.changedProperty).toBe("label");
  });

  it("rejects arbitrary CSS, handlers, and scripts", () => {
    const unsafe = structuredClone(paywallFixture);
    unsafe.tree.children[1].props.style = "background:url(https://tracker.example/pixel)";
    expect(() => validatePaywallSpec(unsafe)).toThrowError(PaywallValidationError);

    const handler = structuredClone(paywallFixture);
    handler.tree.children[1].props.onClick = "javascript:steal()";
    expect(() => validatePaywallSpec(handler)).toThrowError(PaywallValidationError);
  });

  it("rejects a plan that targets a different source or locked-fact hash", () => {
    expect(() => buildPaywallVariants(paywallFixture, { ...changePlanFixture, source_spec_hash: "c".repeat(64) })).toThrowError(/does not target/);
    expect(() => buildPaywallVariants(paywallFixture, { ...changePlanFixture, locked_facts_hash: "c".repeat(64) })).toThrowError(/preserve/);
  });

  it("does not allow benefit changes disguised as a reorder", () => {
    expect(() => buildPaywallVariants(paywallFixture, {
      ...changePlanFixture,
      operation: { kind: "reorder_benefits", target_component_id: "benefit-list", value: ["Invented benefit"] },
    })).toThrowError(/cannot add/);
  });

  it("renders the fixed React registry without source HTML", () => {
    const state = createPaywallInteraction("growth");
    const html = renderToStaticMarkup(<PaywallRegistryView spec={paywallFixture} state={state} dispatch={() => undefined} />);
    expect(html).toContain("Northstar Growth");
    expect(html).toContain("I would stop here");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });

  it("enforces selection, fake-details validation, review, decision, and survey", () => {
    let state = createPaywallInteraction();
    expect(() => reducePaywallInteraction(state, { type: "open_checkout" })).toThrowError(/Select a plan/);
    state = reducePaywallInteraction(state, { type: "select_plan", planId: "growth" });
    state = reducePaywallInteraction(state, { type: "open_checkout" });
    expect(() => reducePaywallInteraction(state, { type: "open_review" })).toThrowError(/fake details/);
    state = reducePaywallInteraction(state, { type: "confirm_fake_details", confirmed: true });
    state = reducePaywallInteraction(state, { type: "open_review" });
    state = reducePaywallInteraction(state, { type: "complete_simulated_purchase" });
    state = reducePaywallInteraction(state, {
      type: "submit_survey",
      survey: {
        understood_offer: "Northstar Growth",
        understood_price_terms: "$29 monthly",
        hesitation: "Nothing",
        clarity_score: 5,
        trust_score: 4,
        would_continue_with_real_money: true,
        continuation_reason: "The offer was clear",
      },
    });
    expect(state.phase).toBe("complete");
  });
});
