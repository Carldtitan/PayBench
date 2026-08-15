import {
  directionalReportSchema,
  type DirectionalReport,
} from "@paybench/contracts";

export interface CompletedStudySession {
  variant: "A" | "B";
  decision: "continue" | "stop";
  quality: "valid" | "technical_failure" | "rejected" | "flagged";
  clarity_score: number;
  trust_score: number;
}

function average(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function createDirectionalReport(
  jobId: string,
  sessions: CompletedStudySession[],
): DirectionalReport {
  const valid = sessions.filter((session) => session.quality === "valid");
  const a = valid.filter((session) => session.variant === "A").slice(0, 5);
  const b = valid.filter((session) => session.variant === "B").slice(0, 5);
  const technicalFailures = sessions.filter(
    (session) => session.quality === "technical_failure",
  ).length;

  let result: DirectionalReport["result"] = "insufficient_evidence";
  let recommendation =
    "Collect five valid target-customer sessions on each page before choosing a follow-up.";

  if (a.length === 5 && b.length === 5) {
    const aContinue = a.filter((session) => session.decision === "continue").length;
    const bContinue = b.filter((session) => session.decision === "continue").length;
    const aTrust = average(a.map((session) => session.trust_score));
    const bTrust = average(b.map((session) => session.trust_score));
    const aClarity = average(a.map((session) => session.clarity_score));
    const bClarity = average(b.map((session) => session.clarity_score));

    if (bContinue > aContinue && bTrust >= aTrust - 0.5 && bClarity >= aClarity - 0.5) {
      result = "b_stronger_signal";
      recommendation =
        "Use the challenger change as the next production hypothesis, then verify it with a larger test.";
    } else if (aContinue > bContinue && aTrust >= bTrust - 0.5 && aClarity >= bClarity - 0.5) {
      result = "a_stronger_signal";
      recommendation =
        "Keep the current presentation and test a narrower challenger in the next study.";
    } else {
      result = "no_clear_signal";
      recommendation =
        "Keep the current page for now and test one narrower change with a larger sample.";
    }
  }

  return directionalReportSchema.parse({
    contract_version: "2",
    job_id: jobId,
    result,
    valid_sessions: a.length + b.length,
    a_valid: a.length,
    b_valid: b.length,
    technical_failures: technicalFailures,
    recommendation,
    limitation:
      "Directional evidence only; this 10-person study is not statistically significant.",
  });
}
