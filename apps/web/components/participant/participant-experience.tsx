"use client";

import { useEffect, useMemo, useState } from "react";

import type {
  ParticipantCompletion,
  ParticipantDecisionInput,
  ParticipantSessionView,
  ParticipantSurvey,
  StudyEventName,
} from "../../src/server/study/types";
import styles from "./participant.module.css";

type Step = "brief" | "plans" | "checkout" | "review" | "survey" | "done";
type Decision = ParticipantDecisionInput["decision"];

const EMPTY_SURVEY: ParticipantSurvey = {
  understood_offer: "",
  understood_price: "",
  hesitation: "",
  clarity: 0,
  trust: 0,
  would_continue: "no",
  continuation_reason: "",
};

function errorCopy(code?: string): string {
  if (code === "STUDY_LOCKED" || code === "STUDY_NOT_OPEN") return "This task is not open yet.";
  if (code === "PILOT_REVIEW_REQUIRED") return "The first places are complete. More places may open soon.";
  if (code === "NO_ASSIGNMENT_AVAILABLE") return "All open places are filled.";
  if (code === "TERAC_SUBMISSION_DUPLICATE") return "This task submission is already in use.";
  if (code === "SURVEY_INCOMPLETE") return "Answer every survey question.";
  return "The task could not load. Try once more.";
}

async function recordEvent(event: StudyEventName) {
  await fetch("/api/study/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event }),
  });
}

export function ParticipantExperience({ token }: { token: string }) {
  const [view, setView] = useState<ParticipantSessionView>();
  const [step, setStep] = useState<Step>("brief");
  const [matched, setMatched] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [decision, setDecision] = useState<Decision>();
  const [survey, setSurvey] = useState<ParticipantSurvey>(EMPTY_SURVEY);
  const [completion, setCompletion] = useState<ParticipantCompletion>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    const teracSubmissionId = new URLSearchParams(window.location.search).get("teracSubmissionId") ?? undefined;
    void fetch("/api/study/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, teracSubmissionId }),
    })
      .then(async (response) => {
        const envelope = (await response.json()) as {
          ok: boolean;
          data?: ParticipantSessionView;
          error?: { code?: string };
        };
        if (!response.ok || !envelope.ok || !envelope.data) throw new Error(envelope.error?.code);
        if (!active) return;
        setView(envelope.data);
        setSelectedPlanId(envelope.data.default_plan_id);
        if (envelope.data.resume_decision === "stop") {
          setDecision("stop");
          setStep("survey");
        }
      })
      .catch((caught: unknown) => {
        if (active) setError(errorCopy(caught instanceof Error ? caught.message : undefined));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const selectedPlan = useMemo(
    () => view?.plans.find((plan) => plan.id === selectedPlanId),
    [selectedPlanId, view],
  );

  const move = (next: Step, event?: StudyEventName) => {
    setError(undefined);
    setStep(next);
    if (event) void recordEvent(event);
  };

  const chooseStop = () => {
    setDecision("stop");
    move("survey", "stop_selected");
  };

  const finishReview = () => {
    if (!selectedPlan) {
      setError("Choose one plan.");
      return;
    }
    setDecision("complete_simulated_purchase");
    move("survey", "simulated_purchase_completed");
  };

  const submitSurvey = async () => {
    if (!decision) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const response = await fetch("/api/study/decision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, selected_plan_id: selectedPlanId, survey }),
      });
      const envelope = (await response.json()) as {
        ok: boolean;
        data?: ParticipantCompletion;
        error?: { code?: string };
      };
      if (!response.ok || !envelope.ok || !envelope.data) throw new Error(envelope.error?.code);
      setCompletion(envelope.data);
      if (envelope.data.outcome === "redirect" && envelope.data.redirect_url) {
        window.location.assign(envelope.data.redirect_url);
        return;
      }
      setStep("done");
    } catch (caught) {
      setError(errorCopy(caught instanceof Error ? caught.message : undefined));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <main className={styles.loading} aria-live="polite">Preparing your task…</main>;
  }

  if (!view || error && step === "brief") {
    return (
      <main className={styles.loading}>
        <div className={styles.errorPanel} role="alert">
          <strong>Task unavailable</strong>
          <span>{error ?? "The task could not load."}</span>
          <button type="button" onClick={() => window.location.reload()}>Try again</button>
        </div>
      </main>
    );
  }

  const progress = step === "brief" ? 1 : step === "plans" ? 2 : step === "checkout" ? 3 : step === "review" ? 4 : 5;

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <span className={styles.mark}>PB</span>
        <strong>Purchase task</strong>
        <span className={styles.progress}>Step {progress} of 5</span>
      </header>

      <div className={styles.taskStrip} aria-label="Task terms">
        <span>10 min</span>
        <strong>$5</strong>
        <span>Same pay if you buy or stop</span>
        <span>No charge</span>
      </div>

      <div className={styles.workspace}>
        {step === "brief" ? (
          <section className={styles.brief}>
            <div className={styles.briefMain}>
              <span className={styles.wordmark}>{view.brand_name}</span>
              <h1>Decide as you normally would.</h1>
              <p>Review one purchase page with simulated money and preset details.</p>
              <ul>
                <li>No account.</li>
                <li>No real payment information.</li>
                <li>No correct answer.</li>
              </ul>
            </div>
            <div className={styles.fitPanel}>
              <h2>Target customer</h2>
              <p>{view.target_customer}</p>
              <label className={styles.checkRow}>
                <input type="checkbox" checked={matched} onChange={(event) => setMatched(event.target.checked)} />
                <span>I match this description.</span>
              </label>
              <button className={styles.primary} type="button" disabled={!matched} onClick={() => move("plans")}>Start</button>
            </div>
          </section>
        ) : null}

        {step === "plans" ? (
          <section className={styles.pageModule}>
            <span className={styles.wordmark}>{view.brand_name}</span>
            <h1>{view.headline}</h1>
            <p className={styles.support}>{view.supporting_copy}</p>
            <div className={styles.planList}>
              {view.plans.map((plan) => (
                <label className={styles.plan} data-selected={selectedPlanId === plan.id} key={plan.id}>
                  <input
                    type="radio"
                    name="plan"
                    value={plan.id}
                    checked={selectedPlanId === plan.id}
                    onChange={() => {
                      setSelectedPlanId(plan.id);
                      void recordEvent("plan_selected");
                    }}
                  />
                  <span><strong>{plan.name}</strong><small>{plan.detail}</small></span>
                  <span><strong>{plan.price}</strong><small>{plan.terms}</small></span>
                </label>
              ))}
            </div>
            <button className={styles.primary} type="button" onClick={() => move("checkout", "checkout_opened")}>Continue</button>
          </section>
        ) : null}

        {step === "checkout" ? (
          <section className={styles.pageModule}>
            <div className={styles.sectionHead}>
              <div><h1>Preset checkout</h1><p>These details are fake and cannot create a charge.</p></div>
              <span className={styles.simulation}>Simulation</span>
            </div>
            <div className={styles.fakeFields}>
              <label>Name<input readOnly value={view.preset.name} /></label>
              <label>Postal code<input readOnly value={view.preset.postal_code} /></label>
              <label>Simulation token<input readOnly value={view.preset.payment_token} /></label>
            </div>
            <button className={styles.primary} type="button" onClick={() => move("review", "review_opened")}>Review order</button>
          </section>
        ) : null}

        {step === "review" && selectedPlan ? (
          <section className={styles.review}>
            <div>
              <span className={styles.wordmark}>{view.brand_name}</span>
              <h1>Review</h1>
              <p>{selectedPlan.name}</p>
            </div>
            <div className={styles.total}>
              <span>{selectedPlan.terms}</span>
              <strong>{selectedPlan.price}</strong>
            </div>
            <div className={styles.notice}>No money moves. This action records only your simulated decision.</div>
            <button className={styles.primary} type="button" onClick={finishReview}>Complete simulated purchase</button>
          </section>
        ) : null}

        {step === "survey" ? (
          <section className={styles.survey}>
            <div className={styles.sectionHead}>
              <div><h1>Why did you decide that?</h1><p>Your pay does not depend on your answer.</p></div>
              <span className={styles.decisionMark}>{decision === "stop" ? "Stopped" : "Continued"}</span>
            </div>
            <label>What did you think you were buying?<textarea required value={survey.understood_offer} onChange={(event) => setSurvey({ ...survey, understood_offer: event.target.value })} /></label>
            <label>What price and billing terms did you understand?<textarea required value={survey.understood_price} onChange={(event) => setSurvey({ ...survey, understood_price: event.target.value })} /></label>
            <label>What made you hesitate?<textarea required value={survey.hesitation} onChange={(event) => setSurvey({ ...survey, hesitation: event.target.value })} /></label>
            <div className={styles.scoreGrid}>
              <label>Offer clarity<select required value={survey.clarity || ""} onChange={(event) => setSurvey({ ...survey, clarity: Number(event.target.value) })}><option value="">Choose</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
              <label>Page trust<select required value={survey.trust || ""} onChange={(event) => setSurvey({ ...survey, trust: Number(event.target.value) })}><option value="">Choose</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            </div>
            <label>Would you continue with real money?<select value={survey.would_continue} onChange={(event) => setSurvey({ ...survey, would_continue: event.target.value as "yes" | "no" })}><option value="no">No</option><option value="yes">Yes</option></select></label>
            <label>Why?<textarea required value={survey.continuation_reason} onChange={(event) => setSurvey({ ...survey, continuation_reason: event.target.value })} /></label>
            {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
            <button className={styles.primary} type="button" disabled={submitting} onClick={() => void submitSurvey()}>{submitting ? "Finishing…" : "Finish task"}</button>
          </section>
        ) : null}

        {step === "done" ? (
          <section className={styles.done}>
            <span className={styles.mark}>✓</span>
            <h1>Task complete</h1>
            <p>Paste this one-use code into your task submission.</p>
            <code>{completion?.completion_code}</code>
          </section>
        ) : null}
      </div>

      {step !== "brief" && step !== "survey" && step !== "done" ? (
        <button className={styles.stopAction} type="button" onClick={chooseStop}>I would stop here</button>
      ) : null}
    </main>
  );
}
