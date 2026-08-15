"use client";

import type { FormEvent } from "react";
import { useState } from "react";

export function OperatorLogin() {
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
      setKey("");
      window.location.assign("/admin");
    } catch {
      setState("error");
    }
  };

  return (
    <main className="access-gate">
      <form onSubmit={submit}>
        <div className="gate-brand"><span>PB</span> PayBench</div>
        <h1>Operator access</h1>
        <label htmlFor="operator-key">Access key</label>
        <input
          id="operator-key"
          name="operator-key"
          type="password"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          autoComplete="off"
          required
          autoFocus
        />
        {state === "error" ? <p role="alert">Key not accepted.</p> : null}
        <button className="primary-button" type="submit" disabled={state === "submitting"}>
          {state === "submitting" ? "Checking…" : "Open run desk"}
        </button>
      </form>
    </main>
  );
}
