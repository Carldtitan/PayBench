import { describe, expect, it } from "vitest";

import {
  DEMO_STUDY_TOKEN,
  MockStudyRepository,
  NEUTRAL_TERAC_BRIEF,
  StudyError,
} from "../../apps/web/src/server/study/repository";
import type { ParticipantDecisionInput } from "../../apps/web/src/server/study/types";

const survey: ParticipantDecisionInput["survey"] = {
  understood_offer: "Team planning software",
  understood_price: "$29 each month",
  hesitation: "I need to compare the annual option",
  clarity: 4,
  trust: 4,
  would_continue: "yes",
  continuation_reason: "The offer fits my team",
};

function openPilot(repository: MockStudyRepository) {
  const hash = repository.dashboardStatus().artifact_bundle_hash;
  repository.approve("pages", hash);
  repository.approve("terac_quote", hash);
}

function complete(repository: MockStudyRepository, cookie: string, decision: ParticipantDecisionInput["decision"] = "stop") {
  return repository.completeDecision(cookie, {
    decision,
    selected_plan_id: decision === "complete_simulated_purchase" ? "growth-monthly" : undefined,
    survey,
  });
}

describe("participant assignment and release gate", () => {
  it("pre-shuffles exactly ten persisted slots: pilot 1A/1B and main 4A/4B", () => {
    const repository = new MockStudyRepository({ random: () => 0.37, signing_secret: "test-secret" });
    const slots = repository.inspectForTests().slots;

    expect(slots).toHaveLength(10);
    expect(slots.filter((slot) => slot.variant === "A")).toHaveLength(5);
    expect(slots.filter((slot) => slot.variant === "B")).toHaveLength(5);
    expect(slots.filter((slot) => slot.phase === "pilot" && slot.variant === "A")).toHaveLength(1);
    expect(slots.filter((slot) => slot.phase === "pilot" && slot.variant === "B")).toHaveLength(1);
    expect(slots.filter((slot) => slot.phase === "main" && slot.variant === "A")).toHaveLength(4);
    expect(slots.filter((slot) => slot.phase === "main" && slot.variant === "B")).toHaveLength(4);
  });

  it("keeps the study locked until both hash-bound approvals pass", () => {
    const repository = new MockStudyRepository({ signing_secret: "test-secret" });
    expect(() => repository.claimSession({ token: DEMO_STUDY_TOKEN })).toThrowError(
      expect.objectContaining({ code: "STUDY_LOCKED" }),
    );
    expect(() => repository.approve("pages", "0".repeat(64))).toThrowError(
      expect.objectContaining({ code: "APPROVAL_ARTIFACT_MISMATCH" }),
    );

    const hash = repository.dashboardStatus().artifact_bundle_hash;
    expect(repository.approve("pages", hash).gate.open).toBe(false);
    const opened = repository.approve("terac_quote", hash);
    expect(opened.gate.open).toBe(true);
    expect(opened.study.phase).toBe("pilot");
    expect(opened.gate.checks.replay_run_present).toBe(true);
    expect(opened.gate.checks.replay_blocking_findings).toBe(0);
  });

  it("does not expose assignment, study IDs, or sandbox details in the participant response", () => {
    const repository = new MockStudyRepository({ signing_secret: "test-secret" });
    openPilot(repository);
    const result = repository.claimSession({ token: DEMO_STUDY_TOKEN });
    const publicJson = JSON.stringify(result.view).toLowerCase();

    expect(publicJson).not.toContain('"variant"');
    expect(publicJson).not.toContain("study_id");
    expect(publicJson).not.toContain("sandbox");
    expect(result.view.preset).toEqual({
      name: "Alex Example",
      postal_code: "00000",
      payment_token: "SIMULATION TOKEN",
    });
  });

  it("keeps a cookie assignment stable and persists a stop through refresh", () => {
    const repository = new MockStudyRepository({ signing_secret: "test-secret" });
    openPilot(repository);
    const first = repository.claimSession({ token: DEMO_STUDY_TOKEN });
    repository.recordEvent(first.cookie_value, "stop_selected");
    const refresh = repository.claimSession({ token: DEMO_STUDY_TOKEN, cookie_value: first.cookie_value });

    expect(refresh.reused).toBe(true);
    expect(refresh.cookie_value).toBe(first.cookie_value);
    expect(refresh.view).toEqual({ ...first.view, resume_decision: "stop" });
  });

  it("requires one completed pilot on each page before the operator can open the remaining eight", () => {
    const repository = new MockStudyRepository({ signing_secret: "test-secret" });
    openPilot(repository);
    expect(() => repository.unlockMain()).toThrowError(expect.objectContaining({ code: "PILOT_INCOMPLETE" }));

    const first = repository.claimSession({ token: DEMO_STUDY_TOKEN });
    const second = repository.claimSession({ token: DEMO_STUDY_TOKEN });
    complete(repository, first.cookie_value);
    complete(repository, second.cookie_value, "complete_simulated_purchase");

    const review = repository.dashboardStatus();
    expect(review.study).toMatchObject({ pilot_completed: 2, main_completed: 0, total_completed: 2 });
    expect(review.pilot_review_required).toBe(true);
    expect(() => repository.claimSession({ token: DEMO_STUDY_TOKEN })).toThrowError(
      expect.objectContaining({ code: "PILOT_REVIEW_REQUIRED" }),
    );
    expect(repository.unlockMain().study.phase).toBe("main");
  });
});

describe("Terac mock completion safety", () => {
  it("stores a submission ID only as HMAC and ciphertext, then uses the mock redirect", () => {
    const repository = new MockStudyRepository({ signing_secret: "test-secret" });
    openPilot(repository);
    const rawId = "terac-submission-private-123";
    const claimed = repository.claimSession({ token: DEMO_STUDY_TOKEN, terac_submission_id: rawId });
    const stored = repository.inspectForTests().sessions[0];

    expect(stored.terac_submission_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.terac_submission_ciphertext).toBeTruthy();
    expect(JSON.stringify(stored)).not.toContain(rawId);
    expect(complete(repository, claimed.cookie_value)).toMatchObject({
      outcome: "redirect",
      redirect_url: expect.stringMatching(/^\/s\/complete\?receipt=/),
    });
  });

  it("rejects duplicate Terac submissions and issues the PB fallback only once", () => {
    const repository = new MockStudyRepository({ signing_secret: "test-secret" });
    openPilot(repository);
    repository.claimSession({ token: DEMO_STUDY_TOKEN, terac_submission_id: "duplicate-id" });
    expect(() => repository.claimSession({ token: DEMO_STUDY_TOKEN, terac_submission_id: "duplicate-id" })).toThrowError(
      expect.objectContaining({ code: "TERAC_SUBMISSION_DUPLICATE" }),
    );

    const fallback = repository.claimSession({ token: DEMO_STUDY_TOKEN });
    expect(complete(repository, fallback.cookie_value)).toMatchObject({
      outcome: "fallback_code",
      completion_code: expect.stringMatching(/^PB-[A-F0-9]{12}$/),
    });
    expect(() => complete(repository, fallback.cookie_value)).toThrowError(
      expect.objectContaining({ code: "DECISION_ALREADY_RECORDED" }),
    );
  });

  it("uses exact neutral task terms and target-customer screening", () => {
    expect(NEUTRAL_TERAC_BRIEF).toContain("About 10 minutes");
    expect(NEUTRAL_TERAC_BRIEF).toContain("Pay: $5");
    expect(NEUTRAL_TERAC_BRIEF).toContain("same pay");
    expect(NEUTRAL_TERAC_BRIEF).toContain("You will not be charged");
    expect(NEUTRAL_TERAC_BRIEF).toContain("Do not create an account");
    expect(NEUTRAL_TERAC_BRIEF).toContain("Do not enter real payment information");
    expect(NEUTRAL_TERAC_BRIEF).toContain("There is no correct answer");
    expect(NEUTRAL_TERAC_BRIEF).toContain("Only take this task if");
    expect(NEUTRAL_TERAC_BRIEF).not.toMatch(/A\/B|variant|general_population/i);
  });
});

it("uses a typed operational error", () => {
  expect(new StudyError("SAFE_FAILURE", 409)).toMatchObject({ code: "SAFE_FAILURE", status: 409 });
});
