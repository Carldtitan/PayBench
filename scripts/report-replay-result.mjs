import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

const journeyIds = [
  "a_desktop_purchase",
  "b_desktop_purchase",
  "a_mobile_purchase",
  "b_mobile_purchase",
  "a_desktop_stop",
  "b_desktop_stop",
  "a_form_validation",
  "b_form_validation",
  "a_survey_submission",
  "b_survey_submission",
  "assignment_refresh_persistence",
  "mocked_terac_redirect",
];

function collectSpecs(suite, output = []) {
  for (const spec of suite?.specs ?? []) output.push(spec);
  for (const child of suite?.suites ?? []) collectSpecs(child, output);
  return output;
}

function specPassed(spec) {
  const results = (spec.tests ?? []).flatMap((test) => test.results ?? []);
  return results.length > 0 && results.every((result) => result.status === "passed");
}

let report = {};
try {
  report = JSON.parse(await readFile("test-results/replay-results.json", "utf8"));
} catch {
  report = {};
}
const specs = collectSpecs(report);
const journeys = Object.fromEntries(journeyIds.map((id) => [id, "missing"]));
for (const spec of specs) {
  const title = String(spec.title ?? "");
  for (const id of journeyIds) {
    if (title.includes(id)) journeys[id] = specPassed(spec) ? "passed" : "failed";
  }
}

const serialized = JSON.stringify(report);
const discoveredRunUrl = serialized.match(/https:\/\/app\.replay\.io\/recording\/[A-Za-z0-9?&=_./-]+/)?.[0];
const runUrl = process.env.REPLAY_RUN_URL || discoveredRunUrl;
const allPassed = journeyIds.every((id) => journeys[id] === "passed");
const failedCount = journeyIds.filter((id) => journeys[id] === "failed").length;
const body = JSON.stringify({
  job_id: process.env.PAYBENCH_JOB_ID,
  artifact_bundle_hash: process.env.PAYBENCH_ARTIFACT_BUNDLE_HASH,
  status: allPassed && runUrl ? "passed" : "failed",
  ...(runUrl ? { run_url: runUrl } : {}),
  blocking_findings: failedCount,
  journeys,
});

const secret = process.env.WORKER_CALLBACK_SECRET;
const callbackUrl = process.env.PAYBENCH_REPLAY_CALLBACK_URL;
if (!secret || !callbackUrl) throw new Error("Replay callback is not configured");
const eventId = `replay-${process.env.GITHUB_RUN_ID ?? Date.now()}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`;
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = createHmac("sha256", secret)
  .update(`${eventId}.${timestamp}.${body}`)
  .digest("hex");
const response = await fetch(callbackUrl, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-paybench-event-id": eventId,
    "x-paybench-timestamp": timestamp,
    "x-paybench-signature": `sha256=${signature}`,
  },
  body,
});
if (!response.ok) throw new Error(`Replay callback failed (${response.status})`);
process.stdout.write(`Replay result recorded; gate remains ${allPassed && runUrl ? "eligible for approvals" : "closed"}.\n`);
