import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { getPublicRunStatus } from "../../../src/server/orchestration/public-run";

export const dynamic = "force-dynamic";

const styles: Record<string, CSSProperties> = {
  shell: { minHeight: "100vh", background: "var(--paper)", padding: "clamp(24px,6vw,72px)" },
  card: { width: "min(760px,100%)", margin: "0 auto", padding: "clamp(24px,5vw,48px)", border: "1px solid var(--line)", borderRadius: 18, background: "var(--worktop)" },
  brand: { display: "flex", alignItems: "center", gap: 10, fontSize: 15, fontWeight: 780 },
  mark: { width: 32, height: 32, display: "grid", placeItems: "center", borderRadius: 9, color: "white", background: "var(--harbor)", fontSize: 11 },
  eyebrow: { margin: "36px 0 10px", color: "var(--harbor)", fontSize: 12, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" },
  title: { margin: 0, fontSize: "clamp(32px,6vw,56px)", lineHeight: 1, letterSpacing: "-.04em" },
  url: { margin: "14px 0 0", color: "var(--muted)", overflowWrap: "anywhere" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginTop: 32 },
  step: { display: "grid", gap: 6, padding: 14, border: "1px solid var(--line)", borderRadius: 10, background: "var(--white)" },
  action: { minHeight: 50, display: "inline-flex", alignItems: "center", justifyContent: "center", marginTop: 24, padding: "0 18px", borderRadius: 10, color: "white", background: "var(--harbor)", fontWeight: 780, textDecoration: "none" },
  note: { margin: "22px 0 0", color: "var(--muted)", fontSize: 13 },
};

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getPublicRunStatus(id).catch(() => null);
  if (!run) notFound();
  const ready = run.state === "participant_ready" || run.state === "complete";
  return (
    <main style={styles.shell}>
      {!ready && run.state !== "failed" ? <meta httpEquiv="refresh" content="4" /> : null}
      <section style={styles.card}>
        <div style={styles.brand}><span style={styles.mark}>PB</span>PayBench</div>
        <p style={styles.eyebrow}>{run.state === "working" ? "Building your test" : run.state === "failed" ? "Run needs attention" : run.state === "complete" ? "Report ready" : "Participant test ready"}</p>
        <h1 style={styles.title}>{run.state === "working" ? "PayBench is working." : run.state === "failed" ? "We could not finish this page." : run.state === "complete" ? "Your result is ready." : "The pilot is open."}</h1>
        <p style={styles.url}>{run.website_url}</p>
        <div style={styles.grid}>
          <div style={styles.step}><strong>{run.source_captured ? "✓" : "…"} Source</strong><span>{run.source_captured ? "Captured" : "Opening page"}</span></div>
          <div style={styles.step}><strong>{run.variants_built ? "✓" : "…"} Pages A/B</strong><span>{run.variants_built ? "Built" : "Generating"}</span></div>
          <div style={styles.step}><strong>{run.qa_passed ? "✓" : "…"} QA</strong><span>{run.qa_passed ? "Passed" : "Checking"}</span></div>
        </div>
        {run.report_url ? <a style={styles.action} href={run.report_url}>Open report</a> : run.participant_url ? <a style={styles.action} href={run.participant_url}>Try participant journey</a> : null}
        <p style={styles.note}>Target customer: {run.target_customer}</p>
      </section>
    </main>
  );
}
