"use client";

import type { CSSProperties, FormEvent } from "react";
import { useState } from "react";

const styles: Record<string, CSSProperties> = {
  shell: { minHeight: "100vh", display: "grid", gridTemplateRows: "auto 1fr", background: "var(--paper)" },
  nav: { height: 68, display: "flex", alignItems: "center", padding: "0 clamp(20px, 5vw, 72px)", borderBottom: "1px solid var(--line)" },
  brand: { display: "flex", alignItems: "center", gap: 10, fontSize: 15, fontWeight: 760 },
  mark: { width: 32, height: 32, display: "grid", placeItems: "center", borderRadius: 9, color: "white", background: "var(--harbor)", fontSize: 11 },
  demoLink: { marginLeft: "auto", minHeight: 38, display: "inline-flex", alignItems: "center", padding: "0 14px", borderRadius: 9, color: "white", background: "var(--harbor)", fontSize: 13, fontWeight: 760, textDecoration: "none" },
  main: { width: "min(1120px, 100%)", margin: "0 auto", padding: "clamp(44px, 9vw, 112px) clamp(20px, 5vw, 72px)", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: "clamp(36px, 8vw, 96px)", alignItems: "start" },
  eyebrow: { margin: "0 0 14px", color: "var(--harbor)", fontSize: 12, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" },
  title: { maxWidth: 570, margin: 0, fontSize: "clamp(38px, 6vw, 76px)", lineHeight: .98, fontWeight: 770, letterSpacing: "-.045em" },
  sub: { maxWidth: 480, margin: "24px 0 0", color: "var(--muted)", fontSize: 17 },
  form: { display: "grid", gap: 18, padding: "clamp(24px, 4vw, 40px)", border: "1px solid var(--line)", borderRadius: 18, background: "var(--worktop)" },
  label: { display: "grid", gap: 7, fontSize: 12, fontWeight: 720 },
  input: { width: "100%", minHeight: 48, padding: "11px 13px", border: "1px solid var(--line)", borderRadius: 9, background: "var(--white)", font: "inherit" },
  textarea: { width: "100%", minHeight: 112, resize: "vertical", padding: "11px 13px", border: "1px solid var(--line)", borderRadius: 9, background: "var(--white)", font: "inherit" },
  button: { minHeight: 48, border: 0, borderRadius: 9, color: "white", background: "var(--harbor)", font: "inherit", fontWeight: 760 },
  error: { margin: 0, color: "var(--danger)", fontSize: 13 },
  success: { display: "grid", gap: 18 },
  link: { minHeight: 48, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 9, color: "white", background: "var(--harbor)", fontWeight: 760, textDecoration: "none" },
};

interface CreatedJob {
  job_id: string;
  payment_url: string;
}

export function FounderIntake() {
  const [website, setWebsite] = useState("");
  const [target, setTarget] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "error">("idle");
  const [created, setCreated] = useState<CreatedJob | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("submitting");
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ website_url: website, target_customer_description: target }),
      });
      const payload = (await response.json()) as { data?: CreatedJob };
      if (!response.ok || !payload.data) throw new Error("failed");
      setCreated(payload.data);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <div style={styles.shell}>
      <nav style={styles.nav}>
        <div style={styles.brand}><span style={styles.mark}>PB</span> PayBench</div>
        <a style={styles.demoLink} href="/demo/linear">Run Linear test</a>
      </nav>
      <main style={styles.main}>
        <section>
          <p style={styles.eyebrow}>Checkout study · $20</p>
          <h1 style={styles.title}>Test the page before customers do.</h1>
          <p style={styles.sub}>One control. One challenger. Ten real end-users. Directional evidence.</p>
        </section>
        <section style={styles.form}>
          {created ? (
            <div style={styles.success}>
              <p style={styles.eyebrow}>Ready</p>
              <h2>Start the test</h2>
              <a style={styles.link} href={created.payment_url}>Pay $20 with Stripe</a>
            </div>
          ) : (
            <form onSubmit={submit} style={{ display: "contents" }}>
              <label style={styles.label}>
                Website
                <input style={styles.input} type="url" value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="https://…" required />
              </label>
              <label style={styles.label}>
                Target customer
                <textarea style={styles.textarea} value={target} onChange={(event) => setTarget(event.target.value)} minLength={20} maxLength={500} placeholder="Who should test this checkout?" required />
              </label>
              {state === "error" ? <p role="alert" style={styles.error}>Check both fields and try again.</p> : null}
              <button style={styles.button} type="submit" disabled={state === "submitting"}>
                {state === "submitting" ? "Checking…" : "Continue"}
              </button>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
