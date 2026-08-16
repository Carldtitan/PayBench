"use client";

import { useState } from "react";

const STAGES = [
  { label: "Source captured", actor: "Superserve", detail: "Linear pricing page secured", evidence: ["Basic · $10 per user / month", "Business · $16 per user / month", "Yearly billing · desktop + mobile captured"] },
  { label: "A/B built", actor: "PayBench", detail: "One controlled change", evidence: ["A reproduces the captured offer", "B emphasizes existing customer proof", "Prices, terms and product claims remain locked"] },
  { label: "Replay QA", actor: "Replay", detail: "12 journeys · 0 blockers", evidence: ["A + B · desktop and mobile", "Purchase, stop, validation and survey passed", "Assignment refresh and redirect passed"] },
  { label: "Terac pilot posted", actor: "Terac", detail: "2 pilot jobs · 1A + 1B", evidence: ["Pilot A · 1 slot · $5", "Pilot B · 1 slot · $5", "Target: product teams evaluating issue trackers"] },
  { label: "10 sessions", actor: "Terac", detail: "5A · 5B · $5 each", evidence: ["A · 2 continued · 3 stopped", "B · 4 continued · 1 stopped", "Median decision time · A 41s · B 29s"] },
  { label: "Report ready", actor: "PayBench", detail: "Directional result", evidence: ["B produced 2 more continue decisions", "Participants found customer proof reassuring", "Directional evidence · not statistically significant"] },
  { label: "Linq delivery", actor: "Linq", detail: "Founder link delivered", evidence: ["Founder-initiated chat · HEALTHY", "Directional report link delivered once", "Delivery receipt recorded"] },
] as const;

type RunState = "idle" | "running" | "complete";

export function LinearDemoRun() {
  const [runState, setRunState] = useState<RunState>("idle");
  const [stageIndex, setStageIndex] = useState(-1);
  function run() {
    setRunState("running");
    setStageIndex(0);
  }

  function next() {
    if (stageIndex >= STAGES.length - 1) {
      setRunState("complete");
      return;
    }
    setStageIndex((current) => current + 1);
  }

  const active = stageIndex >= 0 ? STAGES[stageIndex] : null;
  const completion = runState === "complete" ? 100 : Math.max(0, ((stageIndex + 0.55) / STAGES.length) * 100);

  return (
    <main className="linear-demo">
      <div
        aria-hidden="true"
        dangerouslySetInnerHTML={{
          __html: "<!-- THESIS: A complete test reads as one live cue sheet, never a metric-card dashboard. OWN-WORLD: Harbor paper, ruled cues, brass motion, compact Recursive type. STORY: Start one sample and watch every sponsor handoff resolve into directional evidence. FIRST VIEWPORT: Source and action above a split rundown and live result field. FORM: Established PayBench rundown, precisely extended. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md -->",
        }}
      />

      <header className="demo-topbar">
        <a className="demo-brand" href="/" aria-label="PayBench home"><span>PB</span><strong>PayBench</strong></a>
        <span className="sample-label">Sample run</span>
      </header>

      <div className="demo-worktop">
        <section className="demo-heading" aria-labelledby="linear-run-title">
          <div>
            <h1 id="linear-run-title">Linear checkout study</h1>
            <a href="https://linear.app/pricing" target="_blank" rel="noreferrer">https://linear.app/pricing <span aria-hidden="true">↗</span></a>
            <nav className="source-pages" aria-label="Sample variants"><a href="/demo/linear/a">View A</a><a href="/demo/linear/b">View B</a></nav>
          </div>
          <button type="button" onClick={runState === "running" ? next : run}>
            {runState === "running" ? (stageIndex === STAGES.length - 1 ? "Finish run" : "Next evidence") : runState === "complete" ? "Run again" : "Run Linear test"}
          </button>
        </section>

        <section className="run-console" data-state={runState}>
          <div className="cue-sheet">
            <div className="console-title"><h2>Run</h2><span>{runState === "complete" ? "Complete" : runState === "running" ? `${stageIndex + 1} / ${STAGES.length}` : "Ready"}</span></div>
            <ol>
              {STAGES.map((stage, index) => {
                const status = runState === "complete" || index < stageIndex ? "complete" : index === stageIndex ? "running" : "queued";
                return (
                  <li key={stage.label} data-status={status} aria-current={status === "running" ? "step" : undefined}>
                    <span className="stage-mark" aria-hidden="true">{status === "complete" ? "✓" : index + 1}</span>
                    <span className="stage-copy"><strong>{stage.label}</strong><small>{stage.detail}</small></span>
                    <span className="stage-actor">{stage.actor}</span>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="live-field" aria-live="polite">
            <div className="run-track" aria-hidden="true"><span style={{ transform: `scaleX(${completion / 100})` }} /></div>
            {runState === "idle" ? (
              <div className="ready-state">
                <span className="linear-mark" aria-hidden="true">L</span>
                <h2>Ready for Linear</h2>
                <p>One source. One change. Ten simulated purchase decisions.</p>
              </div>
            ) : runState === "complete" ? (
              <div className="result-state">
                <div className="result-heading"><span>Directional result</span><strong>B was clearer</strong></div>
                <div className="variant-result" data-variant="a"><span>A · Source</span><div><i style={{ width: "40%" }} /></div><strong>2 / 5</strong></div>
                <div className="variant-result" data-variant="b"><span>B · Clearer value</span><div><i style={{ width: "80%" }} /></div><strong>4 / 5</strong></div>
                <dl>
                  <div><dt>Split</dt><dd>5A / 5B</dd></div>
                  <div><dt>Reward</dt><dd>$5 each</dd></div>
                  <div><dt>QA</dt><dd>Passed</dd></div>
                </dl>
                <p>Use B as the next iteration. This 10-person result is directional, not statistically significant.</p>
                <span className="delivered"><i aria-hidden="true" /> Delivered through Linq</span>
              </div>
            ) : (
              <div className="working-state" key={stageIndex}>
                <span className="activity-dot" aria-hidden="true" />
                <h2>{active?.label}</h2>
                <p>{active?.detail}</p>
                <ul className="evidence-list">{active?.evidence.map((item) => <li key={item}>✓ <span>{item}</span></li>)}</ul>
                {stageIndex === 1 ? <div className="mini-variants"><span>A</span><span>B</span></div> : null}
                {stageIndex === 4 ? <div className="session-strip" aria-label="Ten sessions"><span>A</span><span>B</span><span>A</span><span>B</span><span>A</span><span>B</span><span>A</span><span>B</span><span>A</span><span>B</span></div> : null}
              </div>
            )}
          </div>
        </section>

        <footer className="demo-foot"><span>Founder fee · $20</span><span>Participant budget · $50 before Terac fee</span><span>Purchases · simulated</span></footer>
      </div>

      <style jsx>{`
        .linear-demo{min-height:100vh;background:var(--worktop);color:var(--harbor-ink)}
        .demo-topbar{height:64px;display:flex;align-items:center;justify-content:space-between;padding:0 clamp(18px,4vw,48px);border-bottom:1px solid var(--line);background:var(--paper)}
        .demo-brand{display:inline-flex;align-items:center;gap:10px;text-decoration:none;font-size:var(--size-sm)}
        .demo-brand>span{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:var(--harbor);color:var(--white);font-size:var(--size-xxs);font-weight:800}
        .demo-brand strong{font-weight:760}.sample-label{color:var(--muted);font-size:var(--size-xxs)}
        .demo-worktop{width:min(1120px,calc(100% - 36px));margin:0 auto;padding:52px 0 32px}
        .demo-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:28px}
        h1,h2,p{margin:0}.demo-heading h1{max-width:12ch;color:var(--harbor-deep);font-size:clamp(31px,5vw,58px);font-weight:790;letter-spacing:-.035em;line-height:.98;text-wrap:balance}
        .demo-heading a{display:inline-block;margin-top:13px;color:var(--muted);font-variation-settings:"CASL" 0,"MONO" 1;text-decoration:none}.demo-heading a:hover{text-decoration:underline;text-underline-offset:3px}
        .source-pages{display:inline-flex;gap:6px;margin-left:13px}.source-pages a{margin-top:8px;padding:3px 7px;border-radius:6px;background:var(--harbor-pale);color:var(--harbor);font-variation-settings:"CASL" 0,"MONO" 0;font-size:var(--size-xxs);font-weight:720}
        .demo-heading button{height:44px;padding:0 19px;border:0;border-radius:9px;background:var(--harbor);color:var(--white);font-weight:730;box-shadow:4px 5px 0 color-mix(in oklch,var(--harbor) 28%,var(--line));transition:background 140ms ease,transform 140ms ease,box-shadow 140ms ease}
        .demo-heading button:hover:not(:disabled){background:var(--harbor-deep);transform:translate(-1px,-1px);box-shadow:5px 6px 0 color-mix(in oklch,var(--harbor) 28%,var(--line))}
        .run-console{display:grid;grid-template-columns:minmax(350px,.9fr) minmax(0,1.25fr);min-height:536px;overflow:hidden;border-radius:var(--radius);background:var(--paper);box-shadow:0 12px 34px color-mix(in oklch,var(--harbor-deep) 12%,transparent)}
        .cue-sheet{border-right:1px solid var(--line)}.console-title{height:58px;display:flex;align-items:center;justify-content:space-between;padding:0 17px;border-bottom:1px solid var(--line)}
        .console-title h2{font-size:var(--size-md)}.console-title span{color:var(--muted);font-size:var(--size-xxs);font-variation-settings:"CASL" 0,"MONO" 1}
        ol{margin:0;padding:0;list-style:none}li{min-height:68px;display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:11px;padding:8px 17px;border-bottom:1px solid var(--line);transition:background 170ms ease}
        li[data-status="running"]{background:var(--brass-pale)}.stage-mark{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--worktop);color:var(--muted);font-size:var(--size-xxs);font-weight:760}
        li[data-status="running"] .stage-mark{background:var(--brass);color:var(--harbor-deep);box-shadow:2px 3px 9px color-mix(in oklch,var(--brass) 38%,transparent)}li[data-status="complete"] .stage-mark{background:var(--success);color:var(--white)}
        .stage-copy{display:flex;min-width:0;flex-direction:column}.stage-copy strong{font-size:var(--size-xs);font-weight:710}.stage-copy small{overflow:hidden;color:var(--muted);font-size:var(--size-xxs);text-overflow:ellipsis;white-space:nowrap}
        .stage-actor{padding:4px 8px;border-radius:999px;background:var(--harbor-pale);color:var(--harbor);font-size:var(--size-xxs);font-weight:720}
        .live-field{position:relative;display:grid;min-width:0;place-items:center;padding:clamp(28px,6vw,72px);overflow:hidden;background:var(--harbor-deep);color:var(--white)}
        .run-track{position:absolute;top:0;right:0;left:0;height:5px;background:color-mix(in oklch,var(--white) 12%,var(--harbor-deep))}.run-track span{display:block;width:100%;height:100%;transform-origin:left;background:var(--brass);transition:transform 580ms cubic-bezier(.16,1,.3,1)}
        .ready-state,.working-state{max-width:460px;text-align:center}.linear-mark{display:grid;place-items:center;width:64px;height:64px;margin:0 auto 24px;border-radius:14px;background:var(--white);color:var(--harbor-deep);font-size:var(--size-lg);font-weight:840;box-shadow:6px 7px 0 var(--brass)}
        .ready-state h2,.working-state h2{color:var(--white);font-size:var(--size-xl);font-weight:760;letter-spacing:-.025em}.ready-state p,.working-state p{max-width:38ch;margin:10px auto 0;color:color-mix(in oklch,var(--white) 72%,var(--harbor-deep));font-size:var(--size-sm)}
        .evidence-list{display:grid;gap:8px;margin:24px 0 0;padding:0;text-align:left;list-style:none}.evidence-list li{min-height:0;display:flex;grid-template-columns:none;gap:9px;padding:9px 11px;border:1px solid color-mix(in oklch,var(--white) 14%,var(--harbor-deep));border-radius:8px;color:var(--brass);background:color-mix(in oklch,var(--white) 6%,var(--harbor-deep));font-size:var(--size-xs)}.evidence-list span{color:var(--white)}
        .working-state{animation:cue-arrive 480ms cubic-bezier(.16,1,.3,1)}.activity-dot{display:block;width:13px;height:13px;margin:0 auto 25px;border-radius:50%;background:var(--brass);box-shadow:2px 3px 9px color-mix(in oklch,var(--brass) 55%,transparent)}
        .mini-variants{display:flex;justify-content:center;gap:12px;margin-top:28px}.mini-variants span{display:grid;place-items:center;width:72px;height:54px;border-radius:9px;background:var(--paper);color:var(--harbor);font-size:var(--size-md);font-weight:800}.mini-variants span:last-child{background:var(--brass);color:var(--harbor-deep)}
        .session-strip{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin-top:28px}.session-strip span{display:grid;place-items:center;width:31px;height:31px;border-radius:50%;background:var(--harbor);font-size:var(--size-xxs);font-weight:780}.session-strip span:nth-child(even){background:var(--brass);color:var(--harbor-deep)}
        .result-state{width:100%;max-width:520px;animation:result-reveal 620ms cubic-bezier(.16,1,.3,1)}.result-heading{display:flex;flex-direction:column;margin-bottom:34px}.result-heading span{color:var(--brass);font-size:var(--size-xxs);font-weight:740}.result-heading strong{font-size:var(--size-xl);letter-spacing:-.025em}
        .variant-result{display:grid;grid-template-columns:118px minmax(0,1fr) 38px;align-items:center;gap:13px;margin-top:15px}.variant-result>span{font-size:var(--size-xs)}.variant-result>div{height:9px;overflow:hidden;border-radius:999px;background:color-mix(in oklch,var(--white) 13%,var(--harbor-deep))}.variant-result i{display:block;height:100%;background:var(--harbor)}.variant-result[data-variant="b"] i{background:var(--brass)}.variant-result strong{text-align:right}
        dl{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:34px 0 24px;padding:17px 0;border-top:1px solid color-mix(in oklch,var(--white) 16%,var(--harbor-deep));border-bottom:1px solid color-mix(in oklch,var(--white) 16%,var(--harbor-deep))}dl div{display:flex;flex-direction:column}dt{color:color-mix(in oklch,var(--white) 60%,var(--harbor-deep));font-size:var(--size-xxs)}dd{margin:2px 0 0;font-size:var(--size-sm);font-weight:730}.result-state p{max-width:55ch;color:color-mix(in oklch,var(--white) 72%,var(--harbor-deep))}
        .delivered{display:inline-flex;align-items:center;gap:8px;margin-top:25px;padding:5px 9px;border-radius:999px;background:color-mix(in oklch,var(--success) 28%,var(--harbor-deep));font-size:var(--size-xxs);font-weight:710}.delivered i{width:7px;height:7px;border-radius:50%;background:var(--success)}
        .demo-foot{display:flex;gap:22px;padding:17px 3px 0;color:var(--muted);font-size:var(--size-xxs)}.demo-foot span:last-child{margin-left:auto}
        @keyframes cue-arrive{from{clip-path:inset(0 0 20% 0);filter:blur(4px);transform:translateY(9px)}to{clip-path:inset(0);filter:blur(0);transform:none}}@keyframes result-reveal{from{clip-path:inset(0 0 100% 0);filter:blur(3px)}to{clip-path:inset(0);filter:blur(0)}}
        @media(max-width:760px){.demo-worktop{padding-top:32px}.demo-heading{align-items:flex-start;flex-direction:column}.demo-heading h1{font-size:var(--size-xl)}.run-console{grid-template-columns:1fr}.cue-sheet{border-right:0}.live-field{min-height:420px}.demo-foot{flex-wrap:wrap}.demo-foot span:last-child{width:100%;margin-left:0}}
        @media(max-width:430px){.demo-worktop{width:calc(100% - 26px)}.stage-actor{display:none}li{grid-template-columns:34px minmax(0,1fr)}.live-field{padding:30px 20px}.variant-result{grid-template-columns:96px minmax(0,1fr) 34px}.result-heading strong{font-size:var(--size-lg)}dl{gap:4px}.session-strip{grid-template-columns:repeat(5,31px)}}
        @media(prefers-reduced-motion:reduce){*{animation:none!important;transition-duration:.01ms!important}}
      `}</style>
    </main>
  );
}
