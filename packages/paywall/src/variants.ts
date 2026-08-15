import type { ChangePlan, PaywallNode, PaywallSpec } from "@paybench/contracts";
import {
  findPaywallNode,
  PaywallValidationError,
  paywallTopology,
  validateChangePlan,
  validatePaywallSpec,
} from "./validation";

export interface BuiltPaywallVariants {
  control: PaywallSpec;
  challenger: PaywallSpec;
  changePlan: ChangePlan;
  changedComponentId: string;
  changedProperty: string;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function stringValue(value: string | string[]): string {
  if (typeof value !== "string") {
    throw new PaywallValidationError("CHANGE_VALUE_INVALID", "This change requires one string value");
  }
  return value;
}

function stringArrayValue(value: string | string[]): string[] {
  if (!Array.isArray(value)) {
    throw new PaywallValidationError("CHANGE_VALUE_INVALID", "This change requires a string list");
  }
  return value;
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length && [...left].sort().every((item, index) => item === [...right].sort()[index]);
}

function applyOperation(spec: PaywallSpec, plan: ChangePlan): { property: string; tree: PaywallNode } {
  const tree = clone(spec.tree);
  const target = findPaywallNode(tree, plan.operation.target_component_id);
  if (!target) throw new PaywallValidationError("CHANGE_TARGET_MISSING", "Change target does not exist");

  switch (plan.operation.kind) {
    case "replace_headline": {
      if (target.type !== "OfferSummary") throw new PaywallValidationError("CHANGE_TARGET_INVALID", "Headlines belong to OfferSummary");
      const value = stringValue(plan.operation.value);
      const supportedCopy = new Set([
        spec.locked_facts.product_name,
        ...spec.locked_facts.product_details,
        ...spec.locked_facts.claims,
      ]);
      if (!supportedCopy.has(value)) {
        throw new PaywallValidationError("CHANGE_CLAIM_UNSUPPORTED", "A replacement headline must be exact source-supported copy");
      }
      target.props.headline = value;
      return { property: "headline", tree };
    }
    case "replace_primary_action_label": {
      if (target.type !== "PrimaryAction") throw new PaywallValidationError("CHANGE_TARGET_INVALID", "Primary labels belong to PrimaryAction");
      const value = stringValue(plan.operation.value);
      if (
        !/^(?:continue|review|choose|select|see|open|start|complete|next|view)\b/i.test(value) ||
        /\b(?:free|trial|guarantee|discount|save|secure|best|risk-free)\b|[$€£¥]|\d/.test(value)
      ) {
        throw new PaywallValidationError("CHANGE_ACTION_CLAIM_UNSUPPORTED", "Primary action labels must stay factual and action-only");
      }
      target.props.label = value;
      return { property: "label", tree };
    }
    case "reorder_benefits": {
      if (target.type !== "BenefitList") throw new PaywallValidationError("CHANGE_TARGET_INVALID", "Benefit order belongs to BenefitList");
      const current = target.props.items;
      const next = stringArrayValue(plan.operation.value);
      if (!Array.isArray(current) || !current.every((item) => typeof item === "string") || !sameStringSet(current, next)) {
        throw new PaywallValidationError("CHANGE_BENEFITS_INVALID", "Benefit reordering cannot add, remove, or rewrite benefits");
      }
      target.props.items = [...next];
      return { property: "items", tree };
    }
    case "set_default_plan": {
      if (target.type !== "PlanSelector") throw new PaywallValidationError("CHANGE_TARGET_INVALID", "Default plans belong to PlanSelector");
      const value = stringValue(plan.operation.value);
      const plans = target.props.plans;
      if (!Array.isArray(plans) || !plans.some((plan) => plan && typeof plan === "object" && (plan as Record<string, unknown>).id === value)) {
        throw new PaywallValidationError("CHANGE_PLAN_INVALID", "Default plan must reference an existing plan");
      }
      target.props.default_plan_id = value;
      return { property: "default_plan_id", tree };
    }
    case "change_trust_emphasis": {
      if (target.type !== "TrustPanel") throw new PaywallValidationError("CHANGE_TARGET_INVALID", "Trust emphasis belongs to TrustPanel");
      const value = stringValue(plan.operation.value);
      const items = target.props.items;
      if (!Array.isArray(items) || !items.includes(value)) {
        throw new PaywallValidationError("CHANGE_TRUST_INVALID", "Trust emphasis must reference existing source text");
      }
      target.props.emphasized_item = value;
      return { property: "emphasized_item", tree };
    }
  }
}

function countPropertyDiffs(left: unknown, right: unknown): number {
  if (Object.is(left, right)) return 0;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return 1;
    const nested = left.reduce((count, item, index) => count + countPropertyDiffs(item, right[index]), 0);
    return nested === 0 ? 0 : 1;
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    let count = 0;
    for (const key of keys) {
      count += countPropertyDiffs((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]);
    }
    return count;
  }
  return 1;
}

export function buildPaywallVariants(specInput: unknown, planInput: unknown): BuiltPaywallVariants {
  const control = validatePaywallSpec(specInput);
  const changePlan = validateChangePlan(planInput);

  if (changePlan.source_spec_hash !== control.source_hash) {
    throw new PaywallValidationError("SOURCE_SPEC_HASH_MISMATCH", "ChangePlan does not target this PaywallSpec");
  }
  if (changePlan.locked_facts_hash !== control.locked_facts_hash) {
    throw new PaywallValidationError("LOCKED_FACT_HASH_MISMATCH", "ChangePlan does not preserve the locked source facts");
  }

  const applied = applyOperation(control, changePlan);
  const challenger = validatePaywallSpec({ ...clone(control), tree: applied.tree });

  if (paywallTopology(control.tree) !== paywallTopology(challenger.tree)) {
    throw new PaywallValidationError("CHALLENGER_TOPOLOGY_CHANGED", "Challenger must keep the control IDs and component tree");
  }
  if (JSON.stringify(control.locked_facts) !== JSON.stringify(challenger.locked_facts)) {
    throw new PaywallValidationError("LOCKED_FACTS_CHANGED", "Challenger changed locked source facts");
  }
  if (countPropertyDiffs(control.tree, challenger.tree) !== 1) {
    throw new PaywallValidationError("CHANGE_COUNT_INVALID", "Challenger must contain exactly one component-property change");
  }

  return {
    control: clone(control),
    challenger,
    changePlan: clone(changePlan),
    changedComponentId: changePlan.operation.target_component_id,
    changedProperty: applied.property,
  };
}
