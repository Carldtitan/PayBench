"use client";

import type {
  DashboardRunEvent,
  DashboardRunListItem,
  DashboardRunSnapshot,
  DashboardStage,
  DashboardStageStatus,
  SandboxLiveState,
} from "@paybench/contracts";
import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { demoEvents, demoRuns, demoSnapshots } from "../app/admin/demo-data";
import type { OperatorStudyStatus } from "../src/server/study/types";
import {
  AlertIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  ExternalIcon,
  MenuIcon,
  PauseIcon,
  PlayIcon,
  RefreshIcon,
} from "./icons";

type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error?: { code?: string; message?: string } };
type DataMode = "demo" | "live";
type ConnectionState = "connecting" | "connected" | "polling" | "closed";

const stageNumber = (index: number) => String(index + 1).padStart(2, "0");

function timeOnly(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  }).format(new Date(value));
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  }).format(new Date(value));
}

function hostOnly(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

function sentenceCase(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

const DEFAULT_NEXT_ACTION: Record<DashboardStage["id"], string> = {
  intake: "Review the submitted website",
  payment: "Wait for the $20 Stripe payment",
  capture: "Capture the source paywall",
  variants: "Build control A and challenger B",
  replay: "Run checkout QA against both pages",
  approvals: "Approve the pages and Terac quote",
  pilot: "Complete one A and one B pilot",
  study: "Collect the remaining valid sessions",
  report: "Generate the directional report",
  delivery: "Deliver the report through Linq",
};

function isRunList(value: unknown): value is DashboardRunListItem[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const run = item as Partial<DashboardRunListItem>;
    return typeof run.job_id === "string" && typeof run.founder_label === "string" && typeof run.current_stage === "string";
  });
}

function isSnapshot(value: unknown): value is DashboardRunSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<DashboardRunSnapshot>;
  return snapshot.contract_version === "2" && typeof snapshot.job_id === "string" && Array.isArray(snapshot.stages);
}

function isRunEvent(value: unknown): value is DashboardRunEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<DashboardRunEvent>;
  return typeof event.event_id === "string" && typeof event.summary === "string" && typeof event.occurred_at === "string";
}

function isOperatorStudyStatus(value: unknown): value is OperatorStudyStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as Partial<OperatorStudyStatus>;
  return status.contract_version === "2" && typeof status.job_id === "string" && Boolean(status.gate);
}

function StatusGlyph({ status }: { status: DashboardStageStatus }) {
  if (status === "complete") return <CheckIcon />;
  if (status === "running") return <PlayIcon />;
  if (status === "blocked" || status === "failed") return <AlertIcon />;
  return <PauseIcon />;
}

function RunRail({
  runs,
  selectedId,
  onSelect,
  open,
  onClose,
}: {
  runs: DashboardRunListItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <aside className="run-rail" data-open={open} aria-label="Runs">
      <div className="rail-heading">
        <span>Runs</span>
        <span className="rail-count">{runs.length}</span>
        <button className="icon-button mobile-only" type="button" onClick={onClose} aria-label="Close runs">
          <CloseIcon />
        </button>
      </div>
      <div className="run-list">
        {runs.map((run) => (
          <button
            type="button"
            className="run-row"
            data-selected={run.job_id === selectedId}
            key={run.job_id}
            onClick={() => {
              onSelect(run.job_id);
              onClose();
            }}
            aria-current={run.job_id === selectedId ? "page" : undefined}
          >
            <span className="run-row-top">
              <span className="run-name">{run.founder_label}</span>
              <span className="run-source">{run.source === "demo" ? "Demo" : "Live"}</span>
            </span>
            <span className="run-host">{hostOnly(run.website_url)}</span>
            <span className="run-row-foot">
              <span className="status-mark" data-status={run.job_status === "failed" ? "failed" : run.current_stage} />
              {sentenceCase(run.current_stage)}
              <span>{timeOnly(run.updated_at)}</span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function Rundown({ stages, currentStage }: { stages: DashboardStage[]; currentStage: DashboardStage["id"] }) {
  const order: DashboardStage["id"][] = ["intake", "payment", "capture", "variants", "replay", "approvals", "pilot", "study", "report", "delivery"];
  const orderedStages = [...stages].sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id));
  return (
    <section className="rundown" aria-labelledby="rundown-title">
      <div className="section-heading">
        <h2 id="rundown-title">Rundown</h2>
        <span>{orderedStages.filter((item) => item.status === "complete").length}/{orderedStages.length}</span>
      </div>
      <ol className="cue-list">
        {orderedStages.map((item, index) => (
          <li className="cue" data-current={item.id === currentStage} data-status={item.status} key={item.id}>
            <span className="cue-number">{stageNumber(index)}</span>
            <span className="cue-glyph" aria-hidden="true"><StatusGlyph status={item.status} /></span>
            <span className="cue-copy">
              <strong>{item.label}</strong>
              {item.detail ? <span>{item.detail}</span> : null}
            </span>
            <span className="actor-chip">{item.actor}</span>
            <span className="cue-time">{timeOnly(item.completed_at ?? item.started_at)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function DemoFrame({ variant }: { variant: "A" | "B" }) {
  return (
    <div className="demo-frame" aria-label={`Demo frame for variant ${variant}`}>
      <div className="browser-bar"><i /><i /><i /><span>paybench.preview</span></div>
      <div className="demo-page">
        <span className="demo-wordmark">NORTHSTAR</span>
        <div className="demo-offer">
          <span className="demo-plan">Growth</span>
          <strong>{variant === "A" ? "$29 / month" : "$290 / year"}</strong>
          <span>{variant === "A" ? "For teams shipping weekly" : "Two months free · billed annually"}</span>
          <button type="button" tabIndex={-1}>{variant === "A" ? "Start now" : "Choose annual"}</button>
        </div>
      </div>
      <span className="demo-stamp">Demo frame</span>
    </div>
  );
}

function EmptyFrame({ variant }: { variant: "A" | "B" }) {
  return (
    <div className="demo-frame" aria-label={`Private preview for variant ${variant} is not ready`}>
      <div className="browser-bar"><i /><i /><i /><span>private preview</span></div>
      <div className="demo-page">
        <div className="demo-offer">
          <span className="demo-plan">Variant {variant}</span>
          <strong>Waiting for Superserve</strong>
          <span>The private operator preview will appear here.</span>
        </div>
      </div>
      <span className="demo-stamp">No frame</span>
    </div>
  );
}

function SandboxMonitor({ sandbox, demo }: { sandbox: SandboxLiveState; demo: boolean }) {
  const availableLink = sandbox.viewer_url ?? sandbox.preview_url;
  return (
    <section className="sandbox-panel" aria-labelledby={`sandbox-${sandbox.variant}`}>
      <div className="sandbox-heading">
        <div>
          <span className="variant-token">{sandbox.variant}</span>
          <h3 id={`sandbox-${sandbox.variant}`}>{sandbox.task}</h3>
        </div>
        <span className="live-state" data-status={sandbox.status}>
          <i aria-hidden="true" />{sentenceCase(sandbox.status)}
        </span>
      </div>
      <div className="monitor-shell">
        {sandbox.latest_frame_url ? (
          // The API provides a short-lived, private frame URL.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={sandbox.latest_frame_url} alt={`Latest Superserve frame for variant ${sandbox.variant}`} referrerPolicy="no-referrer" />
        ) : availableLink && sandbox.status === "ready" ? (
          <iframe
            src={availableLink}
            title={`Live Superserve preview for variant ${sandbox.variant}`}
            loading="eager"
            referrerPolicy="no-referrer"
            sandbox="allow-forms allow-scripts allow-same-origin"
          />
        ) : (
          demo ? <DemoFrame variant={sandbox.variant} /> : <EmptyFrame variant={sandbox.variant} />
        )}
      </div>
      <div className="sandbox-foot">
        <span>{sandbox.sandbox_id}</span>
        <span>{timeOnly(sandbox.last_activity_at)}</span>
        {availableLink ? (
          <a href={availableLink} target="_blank" rel="noreferrer">Open <ExternalIcon /></a>
        ) : (
          <span className="muted-action">No live link</span>
        )}
      </div>
    </section>
  );
}

function WorkSurfaces({ sandboxes, source }: { sandboxes: SandboxLiveState[]; source: DashboardRunSnapshot["source"] }) {
  const byVariant = new Map(sandboxes.map((sandbox) => [sandbox.variant, sandbox]));
  const fallback = (variant: "A" | "B"): SandboxLiveState => ({
    variant,
    sandbox_id: "not-started",
    status: "queued",
    task: variant === "A" ? "Reproduce source paywall" : "Apply one controlled change",
    last_activity_at: new Date(0).toISOString(),
  });

  return (
    <section className="work-surfaces" aria-labelledby="work-title">
      <div className="section-heading">
        <h2 id="work-title">Superserve work</h2>
        <span>2 sandboxes</span>
      </div>
      <div className="sandbox-grid">
        <SandboxMonitor sandbox={byVariant.get("A") ?? fallback("A")} demo={source === "demo"} />
        <SandboxMonitor sandbox={byVariant.get("B") ?? fallback("B")} demo={source === "demo"} />
      </div>
    </section>
  );
}

function StudyPanel({ study }: { study: DashboardRunSnapshot["study"] }) {
  const valid = Math.min(study.valid, study.target);
  const aWidth = valid ? (study.a_valid / Math.max(study.valid, 1)) * 100 : 0;
  const bWidth = valid ? (study.b_valid / Math.max(study.valid, 1)) * 100 : 0;
  return (
    <section className="study-panel" aria-labelledby="study-title">
      <div className="section-heading">
        <h2 id="study-title">Terac study</h2>
        <span>{valid}/{study.target} valid</span>
      </div>
      <div className="study-count">
        <strong>{valid}</strong><span>real end-users</span>
      </div>
      <div className="assignment-bar" aria-label={`${study.a_valid} assigned to A and ${study.b_valid} assigned to B`}>
        <span className="assignment-a" style={{ width: `${aWidth}%` }} />
        <span className="assignment-b" style={{ width: `${bWidth}%` }} />
      </div>
      <dl className="study-stats">
        <div><dt>A</dt><dd>{study.a_valid}</dd></div>
        <div><dt>B</dt><dd>{study.b_valid}</dd></div>
        <div><dt>Flagged</dt><dd>{study.flagged}</dd></div>
        <div><dt>Rejected</dt><dd>{study.rejected}</dd></div>
        <div><dt>Technical</dt><dd>{study.technical_failures}</dd></div>
      </dl>
    </section>
  );
}

function ReplayPanel({ replay }: { replay: DashboardRunSnapshot["replay"] }) {
  const percentage = replay.total_checks ? Math.round((replay.completed_checks / replay.total_checks) * 100) : 0;
  return (
    <section className="replay-panel" data-status={replay.status} aria-labelledby="replay-title">
      <div className="section-heading">
        <h2 id="replay-title">Checkout QA</h2>
        <span className="live-state" data-status={replay.status}><i aria-hidden="true" />{sentenceCase(replay.status)}</span>
      </div>
      <div className="replay-now">
        <span>{replay.current_journey ?? "Queued"}</span>
        <strong>{percentage}%</strong>
      </div>
      <progress max={replay.total_checks || 1} value={replay.completed_checks}>
        {replay.completed_checks} of {replay.total_checks}
      </progress>
      <div className="replay-foot">
        <span>{replay.completed_checks}/{replay.total_checks} checks</span>
        <span>{replay.blocking_findings} blocking</span>
        {replay.run_url ? (
          <a href={replay.run_url} target="_blank" rel="noreferrer">Watch <ExternalIcon /></a>
        ) : (
          <span className="muted-action">Run link pending</span>
        )}
      </div>
    </section>
  );
}

const GATE_LABELS: Record<string, string> = {
  control_matches_source: "Control matches source",
  challenger_has_exactly_one_change: "One controlled change",
  locked_facts_match: "Price, terms, legal, and claims locked",
  desktop_passes: "Desktop pages",
  mobile_passes: "Mobile pages",
  purchase_journey_passes: "Purchase journey",
  stop_journey_passes: "Stop journey",
  validation_passes: "Form validation",
  survey_submission_passes: "Shared survey",
  assignment_persistence_passes: "Stable assignment",
  mocked_terac_redirect_passes: "Mock redirect and PB fallback",
  replay_run_present: "QA run present",
  replay_blocking_findings: "No QA blockers",
  pages_approved: "Pages approved",
  quote_approved: "Quote approved",
  founder_payment_confirmed: "Founder payment confirmed",
  terac_credit_funding_confirmed: "Sponsor credits confirmed",
};

function PrelaunchDesk({
  status,
  busy,
  onApprove,
  onUnlockMain,
}: {
  status: OperatorStudyStatus;
  busy?: string;
  onApprove: (kind: "pages" | "quote") => Promise<void>;
  onUnlockMain: () => Promise<void>;
}) {
  const [copied, setCopied] = useState<"brief" | "link">();
  const copy = async (kind: "brief" | "link", value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(undefined), 1200);
  };
  const checks = Object.entries(status.gate.checks);
  const totalCost = status.funding.participant_subtotal_cents + status.funding.terac_platform_fee_cents;

  return (
    <>
      <section className="artifacts" aria-labelledby="launch-control-title">
        <div className="section-heading">
          <h2 id="launch-control-title">Launch control</h2>
          <span>{status.terac_mode === "mock" ? "Mock only" : status.terac_mode}</span>
        </div>
        <div className="artifact-list">
          <div className="artifact-row">
            <span className="file-mark">FIT</span>
            <span className="artifact-copy"><strong>Target customer</strong><span>{status.target_customer.description}</span></span>
            <time>{status.target_customer.must_match.length} rules</time>
            <span />
          </div>
          <div className="artifact-row">
            <span className="file-mark">$</span>
            <span className="artifact-copy"><strong>{money(totalCost, "usd")} quote</strong><span>10 people × $5 + {money(status.funding.terac_platform_fee_cents, "usd")} fee</span></span>
            <time>{status.funding.sponsor_credits_confirmed ? "Funded" : "Unfunded"}</time>
            <span />
          </div>
          <div className="artifact-row">
            <span className="file-mark">WEB</span>
            <span className="artifact-copy"><strong>Page bundle</strong><span>{status.artifact_bundle_hash.slice(0, 16)}</span></span>
            <time>{status.gate.checks.pages_approved ? "Approved" : "Review"}</time>
            <button className="secondary-button" type="button" disabled={Boolean(busy) || status.gate.checks.pages_approved} onClick={() => void onApprove("pages")}>{busy === "pages" ? "Saving…" : status.gate.checks.pages_approved ? "Approved" : "Approve"}</button>
          </div>
          <div className="artifact-row">
            <span className="file-mark">10×</span>
            <span className="artifact-copy"><strong>Terac quote</strong><span>10 min · $5 equal pay · $50 before fee</span></span>
            <time>{status.gate.checks.quote_approved ? "Approved" : "Review"}</time>
            <button className="secondary-button" type="button" disabled={Boolean(busy) || status.gate.checks.quote_approved} onClick={() => void onApprove("quote")}>{busy === "quote" ? "Saving…" : status.gate.checks.quote_approved ? "Approved" : "Approve"}</button>
          </div>
        </div>
      </section>

      <section className="event-ledger" aria-labelledby="gate-title">
        <div className="section-heading">
          <h2 id="gate-title">Prelaunch gate</h2>
          <span>{status.gate.open ? "Open" : `${checks.filter(([, value]) => value === true || value === 0).length}/${checks.length}`}</span>
        </div>
        <div className="ledger-list">
          {checks.map(([key, value], index) => {
            const passed = value === true || value === 0;
            return (
              <div className="ledger-row" key={key}>
                <time>{String(index + 1).padStart(2, "0")}</time>
                <span className="ledger-dot" data-status={passed ? "complete" : "waiting"} aria-hidden="true" />
                <strong>{passed ? "Pass" : "Wait"}</strong>
                <span>{GATE_LABELS[key] ?? sentenceCase(key)}</span>
                <span className="ledger-stage">Gate</span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="evidence-grid">
        <section className="study-panel" aria-labelledby="release-title">
          <div className="section-heading">
            <h2 id="release-title">Participant release</h2>
            <span>{sentenceCase(status.study.phase)}</span>
          </div>
          <div className="study-count"><strong>{status.study.total_completed}</strong><span>/ 10 complete</span></div>
          <div className="assignment-bar" aria-label={`${status.study.a_completed} of 5 assigned to A and ${status.study.b_completed} of 5 assigned to B`}>
            <span className="assignment-a" style={{ width: `${status.study.a_completed * 10}%` }} />
            <span className="assignment-b" style={{ width: `${status.study.b_completed * 10}%` }} />
          </div>
          <dl className="study-stats">
            <div><dt>Pilot</dt><dd>{status.study.pilot_completed}/2</dd></div>
            <div><dt>Main</dt><dd>{status.study.main_completed}/8</dd></div>
            <div><dt>Total</dt><dd>{status.study.total_completed}/10</dd></div>
            <div><dt>A locked</dt><dd>5</dd></div>
            <div><dt>B locked</dt><dd>5</dd></div>
          </dl>
          {status.pilot_review_required ? <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void onUnlockMain()}>{busy === "pilot" ? "Opening…" : "Open remaining 8"}</button> : null}
        </section>

        <section className="replay-panel" aria-labelledby="terac-actions-title">
          <div className="section-heading">
            <h2 id="terac-actions-title">Terac handoff</h2>
            <span className="live-state" data-status={status.gate.open ? "ready" : "queued"}><i aria-hidden="true" />{status.gate.open ? "Pilot ready" : "Gate locked"}</span>
          </div>
          <div className="replay-now"><span>Internal mock</span><strong>$5</strong></div>
          <div className="replay-foot">
            <button className="secondary-button" type="button" onClick={() => void copy("brief", status.brief)}>{copied === "brief" ? "Copied" : "Copy brief"}</button>
            <button className="secondary-button" type="button" onClick={() => void copy("link", status.study_url)}>{copied === "link" ? "Copied" : "Copy study link"}</button>
          </div>
        </section>
      </div>
    </>
  );
}

function Artifacts({ artifacts }: { artifacts: DashboardRunSnapshot["artifacts"] }) {
  const [copied, setCopied] = useState<string>();

  const copyPath = async (path: string) => {
    await navigator.clipboard.writeText(path);
    setCopied(path);
    window.setTimeout(() => setCopied(undefined), 1200);
  };

  return (
    <section className="artifacts" aria-labelledby="artifacts-title">
      <div className="section-heading">
        <h2 id="artifacts-title">Artifacts</h2>
        <span>{artifacts.length}</span>
      </div>
      {artifacts.length ? (
        <div className="artifact-list">
          {artifacts.map((artifact) => (
            <div className="artifact-row" key={`${artifact.kind}-${artifact.object_path}`}>
              <span className="file-mark">{artifact.kind === "spec" || artifact.kind === "metrics" ? "JSON" : artifact.kind === "report" ? "PDF" : "WEB"}</span>
              <span className="artifact-copy"><strong>{artifact.label}</strong><span>{artifact.object_path}</span></span>
              <time dateTime={artifact.created_at}>{timeOnly(artifact.created_at)}</time>
              <button className="icon-button" type="button" onClick={() => void copyPath(artifact.object_path)} aria-label={`Copy path for ${artifact.label}`}>
                {copied === artifact.object_path ? <CheckIcon /> : <CopyIcon />}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-row">Artifacts appear as the run advances.</div>
      )}
    </section>
  );
}

function EventLedger({ events }: { events: DashboardRunEvent[] }) {
  return (
    <section className="event-ledger" aria-labelledby="ledger-title">
      <div className="section-heading">
        <h2 id="ledger-title">Event ledger</h2>
        <span>{events.length}</span>
      </div>
      {events.length ? (
        <div className="ledger-list">
          {events.map((event) => (
            <div className="ledger-row" key={event.event_id}>
              <time dateTime={event.occurred_at}>{shortDate(event.occurred_at)}</time>
              <span className="ledger-dot" data-status={event.status} aria-hidden="true" />
              <strong>{event.actor}</strong>
              <span>{event.summary}</span>
              <span className="ledger-stage">{event.stage}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-row">Waiting for the first safe event.</div>
      )}
    </section>
  );
}

function AccessGate({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [key, setKey] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "error">("idle");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState("submitting");
    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ access_key: key }),
      });
      if (!response.ok) throw new Error("Access denied");
      await onSuccess();
    } catch {
      setState("error");
    }
  };

  return (
    <main className="access-gate">
      <form onSubmit={submit}>
        <div className="gate-brand"><span>PB</span> PayBench</div>
        <h1>Operator access</h1>
        <label htmlFor="access-key">Access key</label>
        <input id="access-key" name="access-key" type="password" value={key} onChange={(event) => setKey(event.target.value)} autoComplete="current-password" required autoFocus />
        {state === "error" ? <p role="alert">Key not accepted.</p> : null}
        <button className="primary-button" type="submit" disabled={state === "submitting"}>{state === "submitting" ? "Checking…" : "Open run desk"}</button>
      </form>
    </main>
  );
}

export function OperatorDashboard() {
  const [runs, setRuns] = useState<DashboardRunListItem[]>(demoRuns);
  const [selectedId, setSelectedId] = useState("");
  const [snapshot, setSnapshot] = useState<DashboardRunSnapshot>(demoSnapshots[demoRuns[0].job_id]);
  const [events, setEvents] = useState<DashboardRunEvent[]>(demoEvents[demoRuns[0].job_id] ?? []);
  const [mode, setMode] = useState<DataMode>("demo");
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [needsAccess, setNeedsAccess] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [operatorStudy, setOperatorStudy] = useState<OperatorStudyStatus>();
  const [approvalBusy, setApprovalBusy] = useState<string>();

  const selectedListItem = useMemo(() => runs.find((run) => run.job_id === selectedId), [runs, selectedId]);

  const loadRuns = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/runs", { cache: "no-store" });
      if (response.status === 401) {
        setNeedsAccess(true);
        return false;
      }
      const envelope = (await response.json()) as ApiEnvelope<unknown>;
      const data = envelope.ok ? envelope.data : undefined;
      if (!response.ok || !isRunList(data)) throw new Error("Run list unavailable");
      if (data.length === 0) {
        setRuns([]);
        setMode("live");
        return true;
      }
      setRuns(data);
      setMode(data.every((run) => run.source === "demo") ? "demo" : "live");
      setSelectedId((current) => data.some((run) => run.job_id === current) ? current : data[0].job_id);
      setNeedsAccess(false);
      return true;
    } catch {
      setRuns(demoRuns);
      setMode("demo");
      setConnection("closed");
      return false;
    }
  }, []);

  const loadSnapshot = useCallback(async (runId: string, quiet = false) => {
    if (!quiet) setError(undefined);
    try {
      const response = await fetch(`/api/admin/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
      if (response.status === 401) {
        setNeedsAccess(true);
        return;
      }
      const envelope = (await response.json()) as ApiEnvelope<unknown>;
      if (!response.ok || !envelope.ok || !isSnapshot(envelope.data)) throw new Error("Run unavailable");
      setSnapshot(envelope.data);
      setMode(envelope.data.source);
      setNeedsAccess(false);
    } catch {
      const demo = demoSnapshots[runId];
      if (demo) {
        setSnapshot(demo);
        setEvents(demoEvents[runId] ?? []);
        setMode("demo");
      } else if (!quiet) {
        setError("Run unavailable. Select another run.");
      }
    }
  }, []);

  const loadOperatorStudy = useCallback(async (runId: string) => {
    try {
      const response = await fetch(`/api/admin/runs/${encodeURIComponent(runId)}/approvals`, { cache: "no-store" });
      const envelope = (await response.json()) as ApiEnvelope<unknown>;
      if (!response.ok || !envelope.ok || !isOperatorStudyStatus(envelope.data)) {
        setOperatorStudy(undefined);
        return;
      }
      setOperatorStudy(envelope.data);
    } catch {
      setOperatorStudy(undefined);
    }
  }, []);

  const approve = useCallback(async (kind: "pages" | "quote") => {
    if (!operatorStudy) return;
    setApprovalBusy(kind);
    try {
      const response = await fetch(`/api/admin/runs/${encodeURIComponent(selectedId)}/approvals/${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artifact_bundle_hash: operatorStudy.artifact_bundle_hash }),
      });
      const envelope = (await response.json()) as ApiEnvelope<unknown>;
      if (!response.ok || !envelope.ok || !isOperatorStudyStatus(envelope.data)) throw new Error("Approval failed");
      setOperatorStudy(envelope.data);
    } catch {
      setError("Approval failed. Refresh and try again.");
    } finally {
      setApprovalBusy(undefined);
    }
  }, [operatorStudy, selectedId]);

  const unlockMain = useCallback(async () => {
    setApprovalBusy("pilot");
    try {
      const response = await fetch(`/api/admin/runs/${encodeURIComponent(selectedId)}/approvals/pilot`, { method: "POST" });
      const envelope = (await response.json()) as ApiEnvelope<unknown>;
      if (!response.ok || !envelope.ok || !isOperatorStudyStatus(envelope.data)) throw new Error("Pilot unlock failed");
      setOperatorStudy(envelope.data);
    } catch {
      setError("Complete one pilot session on each page before opening the remaining eight.");
    } finally {
      setApprovalBusy(undefined);
    }
  }, [selectedId]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const apiAvailable = await loadRuns();
    if (apiAvailable && selectedId) await loadSnapshot(selectedId, true);
    setRefreshing(false);
  }, [loadRuns, loadSnapshot, selectedId]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (!selectedId) return;
    setEvents([]);
    const demo = demoSnapshots[selectedId];
    if (demo) {
      setSnapshot(demo);
    }
    void loadSnapshot(selectedId);
  }, [loadSnapshot, selectedId]);

  useEffect(() => {
    if (!selectedId || !["awaiting_approvals", "pilot", "main", "complete"].includes(snapshot.job_status)) {
      setOperatorStudy(undefined);
      return;
    }
    void loadOperatorStudy(selectedId);
  }, [loadOperatorStudy, selectedId, snapshot.job_status]);

  useEffect(() => {
    if (needsAccess || !selectedId) return;
    setConnection("connecting");
    const stream = new EventSource(`/api/admin/runs/${encodeURIComponent(selectedId)}/events`);

    const onRunEvent = (message: Event) => {
      try {
        const nextEvent = JSON.parse((message as MessageEvent<string>).data) as unknown;
        if (!isRunEvent(nextEvent)) return;
        setEvents((current) => [nextEvent, ...current.filter((item) => item.event_id !== nextEvent.event_id)].slice(0, 40));
        setConnection("connected");
        void loadSnapshot(selectedId, true);
      } catch {
        setConnection("polling");
      }
    };

    const onStreamEnd = () => {
      setConnection("polling");
      stream.close();
    };

    stream.addEventListener("run_event", onRunEvent);
    stream.addEventListener("stream_end", onStreamEnd);
    stream.onopen = () => setConnection("connected");
    stream.onerror = () => setConnection("polling");

    return () => stream.close();
  }, [loadSnapshot, needsAccess, selectedId]);

  useEffect(() => {
    if (needsAccess || mode === "demo" || !selectedId) return;
    const timer = window.setInterval(() => void loadSnapshot(selectedId, true), 15_000);
    return () => window.clearInterval(timer);
  }, [loadSnapshot, mode, needsAccess, selectedId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRailOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (needsAccess) return <AccessGate onSuccess={refresh} />;

  if (runs.length === 0) {
    return (
      <main className="zero-state">
        <div className="gate-brand"><span>PB</span> PayBench</div>
        <h1>No runs yet</h1>
        <button type="button" className="secondary-button" onClick={() => void refresh()}><RefreshIcon /> Refresh</button>
      </main>
    );
  }

  return (
    <div className="dashboard-shell">
      <header className="topbar">
        <button className="icon-button mobile-only" type="button" onClick={() => setRailOpen(true)} aria-label="Open runs"><MenuIcon /></button>
        <a className="brand" href="/admin" aria-label="PayBench run desk"><span>PB</span><strong>PayBench</strong></a>
        <span className="desk-name">Run desk</span>
        <div className="topbar-actions">
          <span className="connection" data-state={mode === "demo" ? "demo" : connection}><i aria-hidden="true" />{mode === "demo" ? "Demo data" : sentenceCase(connection)}</span>
          <button className="secondary-button refresh-button" type="button" onClick={() => void refresh()} disabled={refreshing} aria-label={refreshing ? "Refreshing runs" : "Refresh runs"}>
            <RefreshIcon /> <span>{refreshing ? "Refreshing…" : "Refresh"}</span>
          </button>
        </div>
      </header>

      {railOpen ? <button className="rail-scrim mobile-only" type="button" aria-label="Close runs" onClick={() => setRailOpen(false)} /> : null}
      <RunRail runs={runs} selectedId={selectedId} onSelect={setSelectedId} open={railOpen} onClose={() => setRailOpen(false)} />

      <main className="run-workspace">
        <header className="run-header">
          <div>
            <div className="run-title-line">
              <h1>{snapshot.founder_label}</h1>
              <span className="source-badge" data-source={snapshot.source}>{snapshot.source === "demo" ? "Demo" : "Live"}</span>
            </div>
            <a className="website-link" href={snapshot.website_url} target="_blank" rel="noreferrer">{hostOnly(snapshot.website_url)} <ExternalIcon /></a>
          </div>
          <div className="payment-stamp" data-paid={snapshot.paid}>
            <span>Stripe</span>
            <strong>{snapshot.paid ? money(snapshot.amount_paid_cents, snapshot.currency) : "Unpaid"}</strong>
            <small>{snapshot.paid ? "Paid" : "Pending"}</small>
          </div>
        </header>

        {error ? <div className="inline-error" role="alert"><AlertIcon />{error}</div> : null}

        <div className="primary-grid">
          <Rundown stages={snapshot.stages} currentStage={snapshot.current_stage} />
          <aside className="action-board" data-blocked={Boolean(snapshot.blocker)} aria-label={snapshot.blocker ? "Current blocker" : "Next action"}>
            <span>{snapshot.blocker ? "Blocked" : snapshot.job_status === "delivered" ? "Complete" : "On deck"}</span>
            <strong>{snapshot.blocker?.label ?? snapshot.next_action ?? (snapshot.job_status === "delivered" ? "Founder report delivered" : DEFAULT_NEXT_ACTION[snapshot.current_stage])}</strong>
            {snapshot.blocker ? <code>{snapshot.blocker.code}</code> : <span className="action-actor">{sentenceCase(snapshot.current_stage)}</span>}
          </aside>
        </div>

        {operatorStudy ? <PrelaunchDesk status={operatorStudy} busy={approvalBusy} onApprove={approve} onUnlockMain={unlockMain} /> : null}

        <WorkSurfaces sandboxes={snapshot.sandboxes} source={snapshot.source} />

        <div className="evidence-grid">
          <StudyPanel study={snapshot.study} />
          <ReplayPanel replay={snapshot.replay} />
        </div>

        <Artifacts artifacts={snapshot.artifacts} />
        <EventLedger events={events} />

        <footer className="workspace-foot">
          <span>{selectedListItem?.job_status ? sentenceCase(selectedListItem.job_status) : sentenceCase(snapshot.job_status)}</span>
          <span>{snapshot.job_id.slice(0, 8)}</span>
          <span>Updated {shortDate(snapshot.updated_at)}</span>
        </footer>
      </main>
    </div>
  );
}
