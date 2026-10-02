/** Offline browser acceptance. Requires the explicitly injected fixture-server.ts. */
import { chromium, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const base = process.env.MORA_EVAL_TEST_URL || 'http://127.0.0.1:3108';
const directory = resolve(process.env.MORA_EVAL_BROWSER_EVIDENCE || '.scratch/agent-eval-regression/evidence/11');
const executablePath = process.env.MORA_E2E_BROWSER_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, locale: 'zh-CN' });
const page = await context.newPage();
const errors = [], consoleErrors = [], external = [], checks = [], runs = {};
page.on('pageerror', e => errors.push(String(e)));
page.on('console', e => { if (e.type() === 'error') consoleErrors.push(e.text()); });
await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.hostname !== '127.0.0.1') { external.push(url.origin); return route.abort(); } return route.continue(); });
const api = async (path, body) => { const r = await fetch(base + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); assert.ok(r.ok, `${path}: ${r.status} ${await (!r.ok ? r.text() : Promise.resolve(''))}`); return r.json(); };
async function until(fn, timeout = 180000) { const end = Date.now() + timeout; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 250)); } throw Error('Timed out waiting for offline run'); }
const currentId = () => page.locator('#runIdentity').textContent().then(s => s.split(' · ')[0]);
async function finish() { const id = await currentId(); const s = await until(async () => { const s = await api(`/api/regression/sessions/${id}`); return s.complete && s; }); await expect(page.locator('#runState')).not.toHaveText(/运行中|预检中|正在取消/, { timeout: 15000 }); return s; }
async function models() { await page.locator('#apiKey').fill('fixture-transient-key-no-billing'); await page.locator('#loadModels').click(); await expect(page.locator('#modelState')).toHaveText('模型与当前价格已校验'); }
async function target(ids) { await page.locator('#caseIds').selectOption(ids, { force: true }); await page.locator('#targeted').click(); await expect(page.locator('#previewState')).toContainText(`${ids.length} 条 /`); }
async function start() { await expect(page.locator('#start')).toBeEnabled(); const old = await page.locator('#runIdentity').textContent(); await page.locator('#start').click(); await expect(page.locator('#runIdentity')).not.toHaveText(old); }
async function screenshot(name) { await page.screenshot({ path: join(directory, name), fullPage: true }); }
await mkdir(directory, { recursive: true });
try {
  await page.goto(base); await expect(page.locator('#previewState')).toContainText('8 条 / 8 次');
  assert.equal(await page.locator('#start').isDisabled(), true); checks.push('quick eight; explicit model gate');
  await page.locator('#full').click(); await expect(page.locator('#previewState')).toContainText('64 条 / 64 次'); checks.push('full 64 preflight');
  await page.locator('#quick').click(); await models(); await fetch(base + '/__fixture/hold'); const beforeQuick = (await api('/__fixture/state')).requests.length;
  await start(); await until(async () => (await api('/__fixture/state')).requests.length > beforeQuick); await page.locator('#cancel').click(); const cancelled = await finish(); runs.quickCancelled = cancelled.sessionId;
  assert.equal(cancelled.state, 'cancelled'); assert.ok(cancelled.attempts.some(a => a.state !== 'completed')); assert.ok(cancelled.budget.uncertainUsd > 0); checks.push('quick cancel keeps unknown charging exposure');
  const beforeRefresh = (await api('/__fixture/state')).requests.length;
  await page.reload(); await expect(page.locator('#runIdentity')).toContainText(cancelled.sessionId); assert.equal(await page.locator('#apiKey').inputValue(), ''); await expect(page.locator('#continue')).toBeDisabled();
  assert.equal((await api('/__fixture/state')).requests.length, beforeRefresh); checks.push('refresh restores history without key or paid restart');
  await fetch(base + '/__fixture/malformed'); await models(); await page.locator('#continue').click(); await expect(page.locator('#runIdentity')).not.toContainText(cancelled.sessionId + ' ·'); const continuation = await finish(); runs.continued = continuation.sessionId;
  assert.equal(continuation.previousSessionId, cancelled.sessionId); assert.equal(continuation.attempts.length, cancelled.attempts.filter(a => a.state !== 'completed').length); assert.ok(continuation.attempts.every(a => a.previousAttemptId)); checks.push('manual continuation links only unfinished attempts');
  await target(['regression-format_timing-portrait']); await page.locator('#repeatCase').selectOption('regression-format_timing-portrait'); await expect(page.locator('#previewState')).toContainText('1 条 / 2 次'); await start(); const repeated = await finish(); runs.repeated = repeated.sessionId;
  assert.equal(repeated.attempts.length, 2); assert.ok(repeated.attempts.every(a => a.automatic === 'passed' && a.result.outputPath)); await page.locator('#report').click(); await expect(page.locator('#reportOverview')).toContainText('2 / 2'); const report = await api(`/api/regression/sessions/${repeated.sessionId}/report`); assert.equal(report.overview.human.reviewed, 0); checks.push('targeted repeated real renderer; complete without human');
  await page.locator('#attempts button').first().click(); await page.locator('#outputVideo').evaluate(async v => { await v.play(); }); await until(async () => page.locator('#outputVideo').evaluate(v => v.currentTime > .1 && v.videoWidth === 720)); await page.locator('#outputVideo').evaluate(v => v.pause()); assert.ok((await page.locator('#executions').textContent()).includes('succeeded')); checks.push('real MP4 playback and actual execution receipts');
  await screenshot('desktop-case.png');
  await page.locator('#verdict').selectOption('needs_changes'); await page.locator('#saveReview').click(); await expect(page.locator('#error')).toContainText('至少选择一个问题标签'); await page.locator('input[name="label"][value="requirements"]').check(); await page.locator('#saveReview').click(); await expect(page.locator('#reviewState')).toContainText('已保存'); assert.equal(await page.locator('#note').inputValue(), '');
  await page.reload(); await expect(page.locator('#runIdentity')).toContainText(repeated.sessionId); await page.locator('#attempts button').first().click(); await expect(page.locator('#reviewState')).toContainText('已保存'); await expect(page.locator('input[name="label"][value="requirements"]')).toBeChecked(); checks.push('optional structured labels persist without prose');
  await page.locator('#closeCase').click(); await target(['regression-format_timing-portrait']); await start(); const single = await finish(); runs.single = single.sessionId;
  await page.locator('#report').click(); await page.locator('#reference').selectOption(repeated.sessionId); await page.locator('#chooseReference').click(); await expect(page.locator('#comparison')).toContainText('共同 1'); await expect(page.locator('#comparison')).toContainText('已观测结果相同');
  await page.locator('#reference').selectOption(continuation.sessionId); await page.locator('#chooseReference').click(); await expect(page.locator('#referenceState')).toContainText(continuation.sessionId); const changedReport = await api(`/api/regression/sessions/${single.sessionId}/report`); assert.equal(changedReport.reference.referenceSessionId, continuation.sessionId); checks.push('reference choice/change, snapshots and repetitions remain separate');
  await target(['regression-recovery-render-error']); await start(); const fault = await finish(); runs.fault = fault.sessionId; await page.locator('#attempts button').first().click(); await expect(page.locator('#caseTitle')).toContainText('regression-recovery-render-error'); const receipts = await page.locator('#executions').textContent(); assert.ok(receipts.includes('failed') && receipts.includes('render')); checks.push('actual runner fault/error visible');
  await page.locator('#closeCase').click(); await target(['regression-product-4465899']); await models(); await page.locator('#maxRequestCostUsd').fill('0.000001'); const beforeBudget = (await api('/__fixture/state')).requests.length; await start(); const budget = await finish(); runs.budget = budget.sessionId; assert.equal(budget.state, 'budget_stopped'); assert.equal((await api('/__fixture/state')).requests.length, beforeBudget); await expect(page.locator('#runState')).toHaveText('预算中止'); assert.ok(await page.locator('#runReason').textContent()); checks.push('budget pre-request stop shown, no request dispatched');
  await page.locator('#maxRequestCostUsd').fill('0.010'); await page.locator('#full').click(); await expect(page.locator('#previewState')).toContainText('64 条 / 64 次'); await fetch(base + '/__fixture/hold'); await start(); const fullId = await currentId(); await page.locator('#cancel').click(); const full = await finish(); assert.equal(full.attempts.length, 64); runs.fullCancelled = fullId; checks.push('full 64 frozen start and cancellation');
  await page.locator('#legacyHistory').evaluate(n => { n.closest('details').open = true; }); await page.locator('#legacyHistory button').click(); await expect(page.locator('#legacyReport')).toContainText('Preserved historical report'); checks.push('legacy report read only; absent execution evidence not recorded');
  await page.setViewportSize({ width: 390, height: 844 }); await screenshot('mobile-overview.png'); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); checks.push('mobile no horizontal overflow');
  const storage = await page.evaluate(() => JSON.stringify({ session: { ...sessionStorage }, local: { ...localStorage } })); assert.ok(!storage.includes('fixture-transient-key-no-billing'));
  const state = await api('/__fixture/state'); assert.equal(state.externalProviderCalls, 0); assert.equal(state.blockedExternal, 0); assert.equal(external.length, 0);
  async function scan(path) { for (const e of await readdir(path, { withFileTypes: true })) { const p = join(path, e.name); if (e.isDirectory()) await scan(p); else if (/\.(json|jsonl|md|log)$/.test(e.name)) assert.ok(!(await readFile(p, 'utf8')).includes('fixture-transient-key-no-billing'), `secret persisted in ${p}`); } }
  await scan(join(state.root, 'sessions')); checks.push('credentials absent from browser storage/session/trace/report; zero external requests');
  assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []);
  await writeFile(join(directory, 'browser-acceptance.json'), JSON.stringify({ checks, runs, pageErrors: errors, consoleErrors, externalRequests: external, fixture: state }, null, 2)); console.log(JSON.stringify({ checks: checks.length, runs, pageErrors: errors, consoleErrors, externalRequests: external }, null, 2));
} catch (e) { await screenshot('browser-failure.png'); await writeFile(join(directory, 'browser-failure.json'), JSON.stringify({ error: String(e), checks, runs, pageErrors: errors, consoleErrors }, null, 2)); throw e; }
finally { await browser.close(); }
