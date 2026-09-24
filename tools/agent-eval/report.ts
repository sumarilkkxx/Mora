import { evaluateStoredSession, writeStoredSessionReport } from "./session-results";
import { loadStoredEvaluationSession } from "./evaluation-session";

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find(value => value.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const sessionId = argument("session");
  if (!sessionId) throw new Error("Usage: tsx tools/agent-eval/report.ts --session=<evaluation-session-id>");
  const session = await loadStoredEvaluationSession(sessionId);
  const results = await evaluateStoredSession(session);
  if (results.length !== session.runIds.length) throw new Error(`Evaluation session is incomplete: ${results.length}/${session.runIds.length} traces recorded`);
  const reportPath = await writeStoredSessionReport(session, results);
  const taskSuccess = results.filter(result => result.scores.find(score => score.name === "task_success")?.score === 1).length;
  const totalCostUsd = results.length ? Math.max(...results.map(result => result.cumulativeCostUsd)) : 0;
  process.stdout.write(`${JSON.stringify({ reportPath, cases: results.length, taskSuccess, totalCostUsd }, null, 2)}\n`);
}

main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
