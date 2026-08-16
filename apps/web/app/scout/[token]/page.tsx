import { ScoutTaskForm } from "../../../components/scout-task-form";
import {
  ScoutError,
  getScoutTaskRepository,
  getScoutTaskView,
} from "../../../src/server/scout";

export const dynamic = "force-dynamic";

interface ScoutPageProps {
  params: Promise<{ token: string }>;
}

export default async function ScoutPage({ params }: ScoutPageProps) {
  const { token } = await params;
  let task;
  try {
    task = await getScoutTaskView(await getScoutTaskRepository(), token);
  } catch (error) {
    const message = error instanceof ScoutError && error.code === "SCOUT_TASK_EXPIRED"
      ? "This capture task has expired. Ask the operator for a new link."
      : error instanceof ScoutError && error.code === "SCOUT_TASK_COMPLETE"
        ? "This capture task is already complete."
        : "This capture task is not available.";
    return <main style={{ maxWidth: 680, margin: "64px auto", padding: 24 }}><h1>Capture unavailable</h1><p>{message}</p></main>;
  }

  return (
    <main style={{ maxWidth: 760, margin: "40px auto", padding: "0 22px 56px", color: "#12313d" }}>
      <header style={{ marginBottom: 28 }}>
        <p style={{ marginBottom: 8, color: "#52666d" }}>PayBench scout task</p>
        <h1 style={{ margin: 0, fontSize: 36, lineHeight: 1.1 }}>{task.title}</h1>
      </header>
      <section style={{ padding: 20, borderRadius: 12, background: "#eef4f6", marginBottom: 24 }}>
        <strong>Open exactly</strong>
        <a href={task.target_url} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 8, overflowWrap: "anywhere" }}>{task.target_url}</a>
      </section>
      <ol style={{ display: "grid", gap: 10, paddingLeft: 24, marginBottom: 30 }}>
        {task.steps.map((step) => <li key={step}>{step}</li>)}
      </ol>
      <ScoutTaskForm token={token} task={task} />
    </main>
  );
}
