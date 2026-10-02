/** Actual server-process restart, independent of the in-process recovery test. */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(process.env.MORA_EVAL_RESTART_EVIDENCE || '.scratch/agent-eval-regression/evidence/11/restart-runtime');
const base = 'http://127.0.0.1:3109';
await mkdir(root, { recursive: true });
let child, output = '';
async function until(fn) { const end = Date.now() + 60000; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* startup is not listening yet */ } await new Promise(r => setTimeout(r, 200)); } throw Error('restart acceptance timeout'); }
const api = async (p, body) => { const r = await fetch(base + p, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); assert.ok(r.ok); return r.json(); };
async function launch() { child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'tools/agent-eval/testing/fixture-server.ts'], { env: { ...process.env, MORA_EVAL_TEST_ROOT: root, MORA_EVAL_TEST_PORT: '3109' }, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.on('data', c => { output += c; }); child.stderr.on('data', c => { output += c; }); await until(() => api('/__fixture/state')); }
async function stop() { if (!child || child.exitCode !== null) return; const exit = new Promise(r => child.once('exit', r)); child.kill('SIGTERM'); await exit; }
try {
  await launch(); await fetch(base + '/__fixture/hold');
  const configuration = { provider: 'local-fixture', textModel: 'local-text', visionModel: 'local-vision', stopLimitUsd: .1, maxRequestCostUsd: .01, concurrency: 1, timeoutMs: 60000 };
  const first = await api('/api/regression/sessions', { selection: { mode: 'targeted', caseIds: ['regression-product-4465899'], seed: 0 }, configuration, apiKey: 'transient-restart-fixture' });
  await until(async () => (await api('/__fixture/state')).requests.length === 1);
  await stop(); await launch();
  const recovered = await api(`/api/regression/sessions/${first.sessionId}`); assert.equal(recovered.state, 'interrupted'); assert.equal(recovered.complete, true); assert.ok(recovered.budget.uncertainUsd > 0); assert.ok(recovered.attempts.every(a => a.state === 'interrupted' || a.state === 'not_started'));
  assert.equal((await api('/__fixture/state')).requests.length, 0);
  const continued = await api(`/api/regression/sessions/${first.sessionId}/continue`, { configuration, apiKey: 'transient-restart-fixture' });
  const completed = await until(async () => { const s = await api(`/api/regression/sessions/${continued.sessionId}`); return s.complete && s; });
  assert.equal(completed.previousSessionId, first.sessionId); assert.equal(completed.attempts[0].previousAttemptId, recovered.attempts[0].attemptId); assert.equal(completed.state, 'completed'); assert.equal(completed.attempts[0].automatic, 'failed');
  const report = await api(`/api/regression/sessions/${continued.sessionId}/report`); assert.equal(report.overview.human.reviewed, 0); assert.equal((await api('/__fixture/state')).requests.length, 1);
  await writeFile(join(root, 'restart-acceptance.json'), JSON.stringify({ original: first.sessionId, continuation: continued.sessionId, recoveredBudget: recovered.budget, requestsAfterRestart: 0, requestsAfterExplicitContinue: 1, externalProviderCalls: 0, humanReviewed: 0 }, null, 2)); console.log('Actual restart: interrupted, unknown exposure preserved, no auto request, explicit linked continuation verified');
} finally { await stop(); await writeFile(join(root, 'server.log'), output); }
