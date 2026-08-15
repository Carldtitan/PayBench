const shell = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: "24px",
} as const;

const panel = {
  width: "min(520px, 100%)",
  padding: "32px",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius)",
  background: "var(--paper)",
} as const;

export default function PaymentStatusPage() {
  return (
    <main style={shell}>
      <section style={panel}>
        <div className="gate-brand"><span>PB</span> PayBench</div>
        <h1>Payment received</h1>
        <p>Stripe will confirm it. PayBench starts automatically.</p>
      </section>
    </main>
  );
}

