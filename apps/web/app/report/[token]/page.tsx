import { notFound } from "next/navigation";

import { getFounderReport } from "../../../src/server/study/report";

export const dynamic = "force-dynamic";

function signalLabel(result: string): string {
  if (result === "a_stronger_signal") return "Current page shows the stronger signal";
  if (result === "b_stronger_signal") return "Challenger shows the stronger signal";
  if (result === "no_clear_signal") return "No clear signal";
  return "More completed sessions needed";
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const view = await getFounderReport(token).catch(() => null);
  if (!view) notFound();

  const host = new URL(view.website_url).hostname.replace(/^www\./, "");
  return (
    <main className="report-shell">
      <section className="report-card">
        <div className="report-brand"><span>PB</span><strong>PayBench</strong></div>
        <p className="report-eyebrow">{host} · 10 customer journeys</p>
        <h1>{signalLabel(view.report.result)}</h1>
        <div className="report-metrics" aria-label="Study counts">
          <div><strong>{view.report.a_valid}</strong><span>Page A</span></div>
          <div><strong>{view.report.b_valid}</strong><span>Page B</span></div>
          <div><strong>{view.report.technical_failures}</strong><span>Tech failures</span></div>
        </div>
        <div className="report-recommendation">
          <span>Recommendation</span>
          <p>{view.report.recommendation}</p>
        </div>
        <p className="report-limit">{view.report.limitation}</p>
      </section>
    </main>
  );
}
