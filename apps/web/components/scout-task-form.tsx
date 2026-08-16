"use client";

import { useState, type CSSProperties, type FormEvent } from "react";

import type { ScoutTaskView } from "../src/server/scout/types";

const field: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid #bcc9cc",
  borderRadius: 8,
  padding: "10px 12px",
  background: "#fff",
  color: "#12313d",
  font: "inherit",
};

export function ScoutTaskForm({ token, task }: { token: string; task: ScoutTaskView }) {
  const [state, setState] = useState<"ready" | "sending" | "done" | "error">("ready");
  const [completionCode, setCompletionCode] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    setError("");
    const data = new FormData(event.currentTarget);
    const lines = (name: string) => String(data.get(name) ?? "")
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);
    try {
      const response = await fetch(`/api/scout/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          final_url: data.get("final_url"),
          click_steps: lines("click_steps"),
          visible_offer: data.get("visible_offer"),
          visible_price: data.get("visible_price"),
          visible_terms: data.get("visible_terms"),
          blocker: data.get("blocker"),
          screenshot_urls: lines("screenshot_urls"),
          terac_submission_id: data.get("terac_submission_id") || undefined,
        }),
      });
      const payload = await response.json() as { ok?: boolean; data?: { completion_code?: string }; error?: { code?: string } };
      if (!response.ok || !payload.data?.completion_code) throw new Error(payload.error?.code ?? "SUBMISSION_FAILED");
      setCompletionCode(payload.data.completion_code);
      setState("done");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "SUBMISSION_FAILED");
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <section aria-live="polite" style={{ padding: 24, borderRadius: 12, background: "#e4f5ec" }}>
        <h2 style={{ marginTop: 0 }}>Submitted</h2>
        <p>Use this fallback code if the task platform asks for one.</p>
        <code style={{ display: "inline-block", padding: 12, borderRadius: 8, background: "#fff", fontSize: 18 }}>{completionCode}</code>
      </section>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 18 }}>
      <label><strong>Final URL</strong><input required name="final_url" type="url" inputMode="url" placeholder="https://example.com/checkout" style={{ ...field, marginTop: 6 }} /></label>
      <label><strong>Click steps</strong><span style={{ display: "block", color: "#52666d", margin: "4px 0 6px" }}>One step per line.</span><textarea required name="click_steps" rows={5} placeholder={"Clicked Pricing\nSelected the monthly plan\nClicked Continue"} style={field} /></label>
      <label><strong>Visible offer</strong><textarea required name="visible_offer" rows={3} placeholder="Copy the product or plan offer exactly as shown." style={{ ...field, marginTop: 6 }} /></label>
      <label><strong>Visible price</strong><textarea required name="visible_price" rows={2} placeholder="$20 per month" style={{ ...field, marginTop: 6 }} /></label>
      <label><strong>Visible terms</strong><textarea required name="visible_terms" rows={3} placeholder="Copy billing, renewal, cancellation, and trial terms. Write Not visible if none are shown." style={{ ...field, marginTop: 6 }} /></label>
      <label><strong>Blocker</strong><textarea required name="blocker" rows={2} placeholder="Write None, or describe exactly what stopped you." style={{ ...field, marginTop: 6 }} /></label>
      <label><strong>Screenshot evidence</strong><span style={{ display: "block", color: "#52666d", margin: "4px 0 6px" }}>One HTTPS image link per line. Remove personal and payment information.</span><textarea required name="screenshot_urls" rows={4} placeholder="https://.../full-page.png" style={field} /></label>
      <label><strong>Terac submission ID</strong> <span style={{ color: "#52666d" }}>(optional)</span><input name="terac_submission_id" autoComplete="off" style={{ ...field, marginTop: 6 }} /></label>
      {error ? <p role="alert" style={{ margin: 0, color: "#a32727" }}>Could not submit: {error}</p> : null}
      <button disabled={state === "sending"} type="submit" style={{ border: 0, borderRadius: 8, padding: "12px 16px", background: "#143f4d", color: "white", font: "inherit", fontWeight: 700, cursor: "pointer" }}>
        {state === "sending" ? "Submitting…" : "Submit capture"}
      </button>
    </form>
  );
}
