"use client";

import { useState } from "react";

import styles from "./linear-paywall-demo.module.css";

type Variant = "a" | "b";
type Step = "offer" | "checkout" | "review" | "survey" | "complete";
type PlanId = "basic" | "business";
type Decision = "purchase" | "stop";

const plans = {
  basic: {
    name: "Basic",
    price: 10,
    detail: "5 teams · Unlimited issues · Unlimited file uploads · Admin roles",
  },
  business: {
    name: "Business",
    price: 16,
    detail: "Unlimited teams · Private teams and guests · Triage Intelligence · Linear Insights",
  },
} satisfies Record<PlanId, { name: string; price: number; detail: string }>;

const stepOrder: Step[] = ["offer", "checkout", "review", "survey", "complete"];

export function LinearPaywallDemo({ variant }: { variant: Variant }) {
  const [step, setStep] = useState<Step>("offer");
  const [planId, setPlanId] = useState<PlanId>("business");
  const [confirmed, setConfirmed] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const plan = plans[planId];
  const currentStep = stepOrder.indexOf(step);

  function stop() {
    setDecision("stop");
    setError("");
    setStep("survey");
  }

  function review() {
    if (!confirmed) {
      setError("Confirm the supplied simulation profile to continue.");
      return;
    }
    setError("");
    setStep("review");
  }

  function purchase() {
    setDecision("purchase");
    setStep("survey");
  }

  function submitSurvey() {
    if (!confidence || !reason) {
      setError("Choose a confidence score and one reason.");
      return;
    }
    setError("");
    setStep("complete");
  }

  function reset() {
    setStep("offer");
    setPlanId("business");
    setConfirmed(false);
    setDecision(null);
    setConfidence(null);
    setReason("");
    setError("");
  }

  return (
    <main className={styles.shell} data-variant={variant}>
      <header className={styles.topbar}>
        <a className={styles.wordmark} href="#main" aria-label="Linear simulated checkout">
          <span aria-hidden="true" className={styles.logoMark}><i /><i /><i /><i /></span>
          Linear
        </a>
        <span className={styles.simulationBadge}>Simulation</span>
      </header>

      <div className={styles.progress} aria-label={`Step ${Math.min(currentStep + 1, 4)} of 4`}>
        {stepOrder.slice(0, 4).map((item, index) => (
          <span key={item} data-active={index <= currentStep} />
        ))}
      </div>

      <section className={styles.stage} id="main">
        <div className={styles.contextPane}>
          <div className={styles.orbit} aria-hidden="true">
            <span className={styles.orbitCore}><i /><i /><i /></span>
          </div>
          <div>
            <h1>Plan and build products with precision.</h1>
            <p>Move from idea to release with a system your whole team can trust.</p>
          </div>
          <div className={styles.proof}>
            <span className={styles.proofAvatars} aria-hidden="true"><i>R</i><i>A</i><i>V</i></span>
            <p><strong>Trusted by more than 40,000 companies</strong><span>Built for focused product teams.</span></p>
          </div>
        </div>

        <div className={styles.checkoutPane}>
          {step === "offer" && (
            <section className={styles.flowPanel} aria-labelledby="choose-plan">
              <div className={styles.flowHeading}>
                <h2 id="choose-plan">Choose your plan</h2>
                <p>Prices shown per user. Billed yearly.</p>
              </div>
              <fieldset className={styles.planList}>
                <legend className={styles.srOnly}>Linear plan</legend>
                {(Object.entries(plans) as [PlanId, typeof plans[PlanId]][]).map(([id, item]) => (
                  <label className={styles.plan} key={id} data-selected={planId === id}>
                    <input type="radio" name="plan" checked={planId === id} onChange={() => setPlanId(id)} />
                    <span className={styles.radioDot} aria-hidden="true" />
                    <span className={styles.planCopy}>
                      <strong>{item.name}</strong>
                      <small>{item.detail}</small>
                    </span>
                    <span className={styles.planPrice}><strong>${item.price}</strong><small>user / month</small></span>
                  </label>
                ))}
              </fieldset>
              <button className={styles.primary} type="button" onClick={() => setStep("checkout")}>Continue with {plan.name}</button>
              <button className={styles.stop} type="button" onClick={stop}>I would stop here</button>
            </section>
          )}

          {step === "checkout" && (
            <section className={styles.flowPanel} aria-labelledby="simulated-checkout">
              <button className={styles.back} type="button" onClick={() => { setError(""); setStep("offer"); }}>← Back</button>
              <div className={styles.flowHeading}>
                <h2 id="simulated-checkout">Simulated checkout</h2>
                <p>Use the supplied profile. Do not enter payment details.</p>
              </div>
              <div className={styles.fakeProfile}>
                <div><span>Name</span><strong>Ari Morgan</strong></div>
                <div><span>Workspace</span><strong>Northstar</strong></div>
                <div><span>Test payment</span><strong>Visa ···· 4242</strong></div>
                <div><span>Charge</span><strong>$0.00 simulated</strong></div>
              </div>
              <label className={styles.confirmation}>
                <input type="checkbox" checked={confirmed} onChange={(event) => { setConfirmed(event.target.checked); setError(""); }} />
                <span aria-hidden="true">✓</span>
                Use this simulation profile
              </label>
              {error && <p className={styles.error} role="alert">{error}</p>}
              <button className={styles.primary} type="button" onClick={review}>Review selection</button>
              <button className={styles.stop} type="button" onClick={stop}>I would stop here</button>
            </section>
          )}

          {step === "review" && (
            <section className={styles.flowPanel} aria-labelledby="review-plan">
              <button className={styles.back} type="button" onClick={() => setStep("checkout")}>← Back</button>
              <div className={styles.flowHeading}>
                <h2 id="review-plan">Review</h2>
                <p>No real account or charge will be created.</p>
              </div>
              <dl className={styles.reviewList}>
                <div><dt>Plan</dt><dd>{plan.name}</dd></div>
                <div><dt>Price</dt><dd>${plan.price} per user / month</dd></div>
                <div><dt>Billing</dt><dd>Billed yearly</dd></div>
                <div><dt>Workspace</dt><dd>Northstar · 8 simulated seats</dd></div>
                <div className={styles.total}><dt>Simulated total</dt><dd>${plan.price * 8} / month</dd></div>
              </dl>
              <button className={styles.primary} type="button" onClick={purchase}>Complete simulated purchase</button>
              <button className={styles.stop} type="button" onClick={stop}>I would stop here</button>
            </section>
          )}

          {step === "survey" && (
            <section className={styles.flowPanel} aria-labelledby="quick-check">
              <div className={styles.decisionMark} data-decision={decision}>{decision === "purchase" ? "Purchase selected" : "Stopped"}</div>
              <div className={styles.flowHeading}>
                <h2 id="quick-check">One quick check</h2>
                <p>How certain were you about that choice?</p>
              </div>
              <fieldset className={styles.score}>
                <legend>Confidence</legend>
                {[1, 2, 3, 4, 5].map((value) => (
                  <label key={value} data-selected={confidence === value}>
                    <input type="radio" name="confidence" value={value} checked={confidence === value} onChange={() => { setConfidence(value); setError(""); }} />
                    {value}
                  </label>
                ))}
                <span>Low</span><span>High</span>
              </fieldset>
              <fieldset className={styles.reasons}>
                <legend>What mattered most?</legend>
                {["Plan clarity", "Capabilities", "Trust", "Price"].map((item) => (
                  <label key={item} data-selected={reason === item}>
                    <input type="radio" name="reason" checked={reason === item} onChange={() => { setReason(item); setError(""); }} />
                    {item}
                  </label>
                ))}
              </fieldset>
              {error && <p className={styles.error} role="alert">{error}</p>}
              <button className={styles.primary} type="button" onClick={submitSurvey}>Send response</button>
            </section>
          )}

          {step === "complete" && (
            <section className={`${styles.flowPanel} ${styles.complete}`} aria-labelledby="response-recorded">
              <div className={styles.completeMark} aria-hidden="true">✓</div>
              <div className={styles.flowHeading}>
                <h2 id="response-recorded">Response recorded</h2>
                <p>No charge was made. No account was created.</p>
              </div>
              <button className={styles.secondary} type="button" onClick={reset}>Run again</button>
            </section>
          )}
        </div>
      </section>

      <footer className={styles.footer}>
        <span>PayBench simulation</span>
        <span>Variant {variant.toUpperCase()}</span>
      </footer>
    </main>
  );
}
