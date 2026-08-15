import React, { type FormEvent, type ReactElement, type ReactNode } from "react";
import type { PaywallNode, PaywallSpec } from "@paybench/contracts";
import type {
  PaywallInteractionAction,
  PaywallInteractionState,
  StudySurvey,
} from "./interaction";
import { validatePaywallSpec } from "./validation";

interface RegistryContext {
  spec: PaywallSpec;
  state: PaywallInteractionState;
  dispatch: (action: PaywallInteractionAction) => void;
}

interface RegistryNodeProps extends RegistryContext {
  node: PaywallNode;
  children: ReactNode;
}

interface PlanRecord {
  id: string;
  name: string;
  price_display: string;
  billing_terms?: string[];
}

const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const text = (value: unknown): string => typeof value === "string" ? value : "";
const plans = (value: unknown): PlanRecord[] => Array.isArray(value) ? value as PlanRecord[] : [];

function PaywallShell({ node, children }: RegistryNodeProps): ReactElement {
  return <main className={`pb-paywall pb-paywall--${text(node.props.layout) || "single"}`}>{children}</main>;
}

function BrandHeader({ spec }: RegistryNodeProps): ReactElement {
  return <header className="pb-brand"><span className="pb-brand__mark" aria-hidden="true">{spec.brand.name.slice(0, 2).toUpperCase()}</span><strong>{spec.brand.name}</strong></header>;
}

function OfferSummary({ node }: RegistryNodeProps): ReactElement {
  return <section className="pb-offer"><p className="pb-offer__product">{text(node.props.product_name)}</p><h1>{text(node.props.headline)}</h1>{strings(node.props.supporting_copy).map((line) => <p key={line}>{line}</p>)}<strong className="pb-offer__price">{text(node.props.price_display)}</strong>{strings(node.props.billing_terms).map((term) => <small key={term}>{term}</small>)}</section>;
}

function PlanSelector({ node, state, dispatch }: RegistryNodeProps): ReactElement {
  return <fieldset className="pb-plans"><legend>Choose a plan</legend>{plans(node.props.plans).map((plan) => <label className="pb-plan" key={plan.id}><input type="radio" name="simulated-plan" value={plan.id} checked={state.selectedPlanId === plan.id} onChange={() => dispatch({ type: "select_plan", planId: plan.id })} /><span><strong>{plan.name}</strong><small>{plan.price_display}</small></span></label>)}</fieldset>;
}

function BenefitList({ node }: RegistryNodeProps): ReactElement {
  return <ul className="pb-benefits">{strings(node.props.items).map((item) => <li key={item}>{item}</li>)}</ul>;
}

function TrustPanel({ node }: RegistryNodeProps): ReactElement {
  const emphasized = text(node.props.emphasized_item);
  return <aside className="pb-trust">{strings(node.props.items).map((item) => <p data-emphasized={item === emphasized || undefined} key={item}>{item}</p>)}</aside>;
}

function CheckoutForm({ node, state, dispatch }: RegistryNodeProps): ReactElement {
  if (state.phase !== "checkout") return <></>;
  return <section className="pb-checkout" aria-labelledby={`${node.id}-title`}><h2 id={`${node.id}-title`}>Simulated checkout</h2><dl><div><dt>Name</dt><dd>{text(node.props.fake_customer_name)}</dd></div><div><dt>Address</dt><dd>{text(node.props.fake_billing_address)}</dd></div><div><dt>Payment</dt><dd>{text(node.props.fake_payment_token)}</dd></div></dl><label><input type="checkbox" checked={state.fakeDetailsConfirmed} onChange={(event) => dispatch({ type: "confirm_fake_details", confirmed: event.currentTarget.checked })} />{text(node.props.required_acknowledgement)}</label></section>;
}

function OrderSummary({ node, state }: RegistryNodeProps): ReactElement {
  if (state.phase !== "review") return <></>;
  return <section className="pb-order" aria-labelledby={`${node.id}-title`}><h2 id={`${node.id}-title`}>{text(node.props.title) || "Review"}</h2><p>Selected plan: <strong>{state.selectedPlanId}</strong></p><p>No charge will occur.</p></section>;
}

function PrimaryAction({ node, state, dispatch }: RegistryNodeProps): ReactElement {
  if (state.phase === "survey" || state.phase === "complete") return <></>;
  const action = state.phase === "offer" ? "open_checkout" : state.phase === "checkout" ? "open_review" : "complete_simulated_purchase";
  const label = state.phase === "review" ? "Complete simulated purchase" : text(node.props.label);
  return <button className="pb-primary-action" type="button" onClick={() => dispatch({ type: action })}>{label}</button>;
}

function LegalFooter({ node }: RegistryNodeProps): ReactElement {
  return <footer className="pb-legal">{strings(node.props.items).map((item) => <small key={item}>{item}</small>)}</footer>;
}

function SimulationNotice({ node }: RegistryNodeProps): ReactElement {
  return <aside className="pb-simulation" role="note"><strong>Simulation</strong><span>{text(node.props.message)}</span><span>{text(node.props.simulated_budget)}</span></aside>;
}

const COMPONENTS: Record<PaywallNode["type"], (props: RegistryNodeProps) => ReactElement> = {
  PaywallShell,
  BrandHeader,
  OfferSummary,
  PlanSelector,
  BenefitList,
  TrustPanel,
  CheckoutForm,
  OrderSummary,
  PrimaryAction,
  LegalFooter,
  SimulationNotice,
};

function renderNode(node: PaywallNode, context: RegistryContext): ReactElement {
  const Component = COMPONENTS[node.type];
  return <Component key={node.id} node={node} {...context}>{node.children.map((child) => renderNode(child, context))}</Component>;
}

function Survey({ dispatch }: Pick<RegistryContext, "dispatch">): ReactElement {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const survey: StudySurvey = {
      understood_offer: String(data.get("understood_offer") ?? ""),
      understood_price_terms: String(data.get("understood_price_terms") ?? ""),
      hesitation: String(data.get("hesitation") ?? ""),
      clarity_score: Number(data.get("clarity_score")),
      trust_score: Number(data.get("trust_score")),
      would_continue_with_real_money: data.get("would_continue") === "yes",
      continuation_reason: String(data.get("continuation_reason") ?? ""),
    };
    dispatch({ type: "submit_survey", survey });
  };
  return <form className="pb-survey" onSubmit={submit}><h2>Quick questions</h2><label>What did you think you were buying?<textarea name="understood_offer" required /></label><label>What price and billing terms did you understand?<textarea name="understood_price_terms" required /></label><label>What made you hesitate?<textarea name="hesitation" required /></label><label>Offer clarity<select name="clarity_score" required defaultValue=""><option value="" disabled>Select</option>{[1, 2, 3, 4, 5].map((score) => <option key={score}>{score}</option>)}</select></label><label>Trust<select name="trust_score" required defaultValue=""><option value="" disabled>Select</option>{[1, 2, 3, 4, 5].map((score) => <option key={score}>{score}</option>)}</select></label><fieldset><legend>Would you continue with real money?</legend><label><input type="radio" name="would_continue" value="yes" required />Yes</label><label><input type="radio" name="would_continue" value="no" required />No</label></fieldset><label>Why?<textarea name="continuation_reason" required /></label><button type="submit">Finish</button></form>;
}

export interface PaywallRegistryViewProps {
  spec: PaywallSpec;
  state: PaywallInteractionState;
  dispatch: (action: PaywallInteractionAction) => void;
}

export function PaywallRegistryView({ spec: input, state, dispatch }: PaywallRegistryViewProps): ReactElement {
  const spec = validatePaywallSpec(input);
  if (state.phase === "complete") return <main className="pb-complete"><h1>Complete</h1><p>Return to the task window.</p></main>;
  if (state.phase === "survey") return <Survey dispatch={dispatch} />;
  return <>{renderNode(spec.tree, { spec, state, dispatch })}<button className="pb-stop-action" type="button" onClick={() => dispatch({ type: "stop_here" })}>I would stop here</button></>;
}

export const PAYWALL_COMPONENT_REGISTRY = Object.freeze(Object.keys(COMPONENTS) as PaywallNode["type"][]);
