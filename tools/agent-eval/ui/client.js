"use strict";
const $ = id => document.getElementById(id);
const categoryNames = { product: "产品展示", process: "制作过程", service: "服务体验", difficult: "困难素材", format_timing: "画幅与时间", audio_captions: "声音与字幕", recovery: "故障恢复", safe_stop: "合理停止与补充" };
const stateNames = { created: "预检中", running: "运行中", cancel_requested: "正在取消", completed: "已完成", cancelled: "已取消", budget_stopped: "预算中止", interrupted: "已中断", preflight_failed: "预检失败", not_started: "尚未开始" };
const verdictNames = { passed: "自动通过", failed: "自动失败", unknown: "未知证据", not_evaluated: "未评价" };
const modeNames = { real_model: "配置模型 · 自然素材", real_media: "真实媒体 · 受控 renderer", fixed_response: "固定响应 · runner 故障逻辑" };
const storageKey = "mora-agent-eval-regression-view";
let data, previewValue, catalog, session, reportValue, histories = [], currentAttempt, pollTimer, pollFailures = 0, previewSequence = 0, busy = false;
const node = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
const money = value => "$" + (Number.isFinite(value) ? value.toFixed(6) : "未记录");
const option = (value, text) => { const n = node("option", text); n.value = value; return n; };
function error(message) { $("error").hidden = !message; $("error").textContent = message || ""; }
function runAction(fn) { return async event => { if (event) event.preventDefault(); error(""); try { await fn(); } catch (e) { error(e.message || String(e)); } }; }
async function api(path, body, method = "POST") {
  const response = await fetch(path, { method: body === undefined ? "GET" : method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || `请求失败 ${response.status}`); return value;
}
function saved() { try { return JSON.parse(sessionStorage.getItem(storageKey) || "{}"); } catch { return {}; } }
function persist() {
  const previous = saved();
  const settings = {};
  for (const id of ["seed", "stopLimitUsd", "maxRequestCostUsd", "concurrency", "timeoutSeconds", "provider", "textModel", "visionModel"]) settings[id] = $(id).value || (["textModel", "visionModel"].includes(id) ? previous.settings?.[id] || "" : "");
  sessionStorage.setItem(storageKey, JSON.stringify({ settings, sessionId: session?.sessionId || previous.sessionId }));
}
function selection() {
  const mode = ["quick", "targeted", "full"].find(id => $(id).getAttribute("aria-pressed") === "true");
  const value = { mode, seed: Number($("seed").value) };
  if (mode === "targeted") {
    if ($("category").value) value.categories = [$("category").value];
    if ($("tag").value) value.tags = [$("tag").value];
    const ids = [...$("caseIds").selectedOptions].map(o => o.value); if (ids.length) value.caseIds = ids;
    if ($("historicalFailures").checked) value.historicalFailures = true;
  }
  if ($("repeatCase").value) value.repetitions = { [$("repeatCase").value]: Number($("repeatCount").value) };
  return value;
}
function configuration(cases = previewValue?.cases) {
  const modelNeeded = cases?.some(c => c.evidenceMode === "real_model");
  return { provider: $("provider").value, textModel: $("textModel").value || (modelNeeded ? "" : "not-used"), visionModel: $("visionModel").value || (modelNeeded ? "" : "not-used"), stopLimitUsd: Number($("stopLimitUsd").value), maxRequestCostUsd: Number($("maxRequestCostUsd").value), concurrency: Number($("concurrency").value), timeoutMs: Number($("timeoutSeconds").value) * 1000 };
}
function configurationReason(cases = previewValue?.cases) {
  const config = configuration();
  if (!Number.isFinite(config.stopLimitUsd) || config.stopLimitUsd < .001 || config.stopLimitUsd > 100) return "会话预算必须在 $0.001–100 之间";
  if (!Number.isFinite(config.maxRequestCostUsd) || config.maxRequestCostUsd < .000001 || config.maxRequestCostUsd > config.stopLimitUsd) return "请求上限必须大于零且不超过会话停止线";
  if (!Number.isInteger(config.concurrency) || config.concurrency < 1 || config.concurrency > 4) return "并发必须为 1–4";
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1000 || config.timeoutMs > 3600000) return "每例超时必须为 1–3600 秒";
  if (cases?.some(c => c.evidenceMode === "real_model") && (!catalog || !$("apiKey").value.trim() || !$("textModel").value || !$("visionModel").value)) return "选择包含自然素材：请明确模型并读取当前价格目录";
  return "";
}
function availability() {
  const reason = busy ? "请求处理中" : !previewValue ? "先完成选择与素材预检" : !session?.complete && session ? "当前运行尚未终结" : configurationReason();
  $("start").disabled = !!reason; $("startReason").textContent = reason || "预检通过；点击启动后按下列配置运行";
  $("cancel").disabled = !session || session.complete || session.state === "cancel_requested" || busy;
  const unfinished = session?.attempts.filter(a => a.state !== "completed") || [];
  const continueReason = busy ? "请求处理中" : !session?.complete ? "等待当前运行终结" : !unfinished.length ? "没有未完成项" : configurationReason(unfinished);
  $("continue").disabled = !!continueReason; $("continueReason").textContent = continueReason || `新建关联运行，仅补 ${unfinished.length} 个未完成 attempt`;
  const c = configuration();
  $("launchSummary").textContent = previewValue ? `${previewValue.caseCount} 个案例 / ${previewValue.attemptCount} 次尝试 · ${previewValue.cases.some(c => c.evidenceMode === "real_model") ? `文本 ${c.textModel || "未选"} / 视觉 ${c.visionModel || "未选"}` : "本轮无需模型请求"} · 停止线 ${money(c.stopLimitUsd)} · 单次 ${money(c.maxRequestCostUsd)} · ${c.concurrency} 并发 · ${c.timeoutMs / 1000}s/例` : "";
}
async function preview() {
  const generation = ++previewSequence; previewValue = undefined; availability(); $("previewState").textContent = "正在校验选择、源素材与 oracle hash…";
  try {
    const value = await api("/api/regression/preview", { selection: selection() }); if (generation !== previewSequence) return;
    previewValue = value; $("previewState").textContent = `${value.caseCount} 条 / ${value.attemptCount} 次尝试；素材与冻结协议已校验`;
    $("previewCases").replaceChildren(...value.cases.map(c => { const row = node("div", undefined, "row"); row.append(node("span", c.caseId), node("span", modeNames[c.evidenceMode], "pill")); return row; }));
    const repeat = $("repeatCase").value;
    $("repeatCase").replaceChildren(option("", "不重复"), ...value.caseIds.map(id => option(id, id)));
    if (value.caseIds.includes(repeat)) $("repeatCase").value = repeat;
  } catch (e) { if (generation === previewSequence) { $("previewState").textContent = e.message; error(e.message); } }
  availability(); persist();
}
function changeMode(mode) {
  for (const id of ["quick", "targeted", "full"]) $(id).setAttribute("aria-pressed", String(id === mode));
  $("filters").hidden = mode !== "targeted"; $("repeatCase").value = ""; error(""); return preview();
}
function prices() {
  for (const [id, label] of [["textModel", "textPrice"], ["visionModel", "visionPrice"]]) { const p = catalog?.[id === "textModel" ? "text" : "vision"].find(m => m.id === $(id).value)?.price; $(label).textContent = p ? `输入 $${p.inputUsdPerMillionTokens}/M · 输出 $${p.outputUsdPerMillionTokens}/M` : ""; }
}
async function loadModels() {
  busy = true; availability(); $("loadModels").disabled = true;
  try {
    catalog = await api("/api/regression/models", { provider: $("provider").value, apiKey: $("apiKey").value });
    const settings = saved().settings || {};
    for (const [id, models] of [["textModel", catalog.text], ["visionModel", catalog.vision]]) { const last = $(id).value || settings[id]; $(id).replaceChildren(...models.map(m => option(m.id, m.name))); if (models.some(m => m.id === last)) $(id).value = last; $(id).disabled = false; }
    $("modelState").textContent = "模型与当前价格已校验"; prices(); persist();
  } finally { busy = false; $("loadModels").disabled = false; availability(); }
}
async function start(continuation = false) {
  if (continuation ? $("continue").disabled : $("start").disabled) return;
  busy = true; availability();
  try {
    const path = continuation ? `/api/regression/sessions/${session.sessionId}/continue` : "/api/regression/sessions";
    const value = await api(path, { selection: selection(), configuration: configuration(continuation ? session.attempts.filter(a => a.state !== "completed") : previewValue.cases), apiKey: $("apiKey").value });
    reportValue = undefined; $("reportPanel").hidden = true; $("casePanel").hidden = true; currentAttempt = undefined;
    await openSession(value.sessionId);
  } finally { busy = false; availability(); }
}
function stats(root, values) { $(root).replaceChildren(...values.map(([label, value]) => { const n = node("div", undefined, "stat"); n.append(node("strong", String(value)), node("span", label)); return n; })); }
function renderSession() {
  $("runPanel").hidden = false; $("runState").textContent = stateNames[session.state] || session.state;
  $("runIdentity").textContent = `${session.sessionId} · ${session.startedAt} ${session.previousSessionId ? "· 继续自 " + session.previousSessionId : ""}`;
  const a = session.attempts, finished = a.filter(a => !["not_started", "running"].includes(a.state)).length, passed = a.filter(a => a.state === "completed" && a.automatic === "passed").length, failed = a.filter(a => a.state === "completed" && a.automatic === "failed").length;
  stats("runOverview", [["已终结 / 计划", `${finished} / ${a.length}`], ["通过 / 已评", `${passed} / ${passed + failed}`], ["未评价", a.length - passed - failed], ["确认费用", money(session.budget.spentUsd)], ["在途预约", money(session.budget.reservedUsd)], ["未知计费上界", money(session.budget.uncertainUsd)]]);
  $("progress").max = Math.max(1, a.length); $("progress").value = finished; $("runReason").textContent = session.reason || session.budget.lockReason || "";
  const c = session.configuration;
  $("frozenConfig").textContent = `冻结配置：${c.provider} · ${c.textModel} / ${c.visionModel} · ${money(c.stopLimitUsd)} / ${money(c.maxRequestCostUsd)} · ${c.concurrency} 并发 · seed ${session.selection.seed} · 代码 ${session.code.fingerprint.slice(0, 12)}${session.code.dirty ? "（含未提交内容）" : ""}`;
  $("attempts").replaceChildren(...a.map(a => { const row = node("div", undefined, "row"), copy = node("div", undefined, "copy"), button = node("button", "查看证据", "secondary"); copy.append(node("span", `${a.caseId} · 第 ${a.repetition} 次`), node("small", `${modeNames[a.evidenceMode]} · ${stateNames[a.state] || a.state} · ${verdictNames[a.automatic]}${a.reason ? " · " + a.reason : ""}`, a.automatic)); button.dataset.attemptId = a.attemptId; button.onclick = runAction(() => openCase(a.attemptId)); row.append(copy, button); return row; }));
  if (currentAttempt) { const updated = a.find(a => a.attemptId === currentAttempt.attemptId); if (updated) renderCaseData(updated); }
  availability(); persist();
}
async function openSession(id) {
  clearTimeout(pollTimer); pollFailures = 0;
  session = await api(`/api/regression/sessions/${id}`); renderSession(); await history();
  if (!session.complete) pollTimer = setTimeout(() => poll(id), 750);
}
async function poll(id) {
  if (session?.sessionId !== id) return;
  try { const value = await api(`/api/regression/sessions/${id}`); if (session?.sessionId !== id) return; session = value; pollFailures = 0; renderSession(); if (session.complete) { await history(); return; } }
  catch (e) { pollFailures++; error(`状态读取失败 ${pollFailures}/5：${e.message}`); if (pollFailures >= 5) { error("状态读取中止，请点击刷新历史重新连接；不会自动重试运行。"); return; } }
  pollTimer = setTimeout(() => poll(id), Math.min(5000, 750 * (pollFailures + 1)));
}
async function history() {
  histories = await api("/api/regression/sessions");
  $("history").replaceChildren(...histories.map(s => { const row = node("div", undefined, "row"), copy = node("div", undefined, "copy"), button = node("button", "打开运行", "secondary"); copy.append(node("span", s.sessionId), node("small", `${s.startedAt} · ${stateNames[s.state]} · ${s.selection.caseIds.length} 条`)); button.dataset.sessionId = s.sessionId; button.onclick = runAction(async () => { currentAttempt = undefined; $("casePanel").hidden = true; $("reportPanel").hidden = true; await openSession(s.sessionId); }); row.append(copy, button); return row; }));
  if (!histories.length) $("history").append(node("p", "暂无运行。先预检选择，再启动回归。", "muted"));
  const previous = $("reference").value;
  $("reference").replaceChildren(option("", "请选择参考"), ...histories.filter(s => s.sessionId !== session?.sessionId).map(s => option(s.sessionId, `${s.startedAt} · ${s.sessionId}`)));
  if ([...$("reference").options].some(o => o.value === previous)) $("reference").value = previous;
}
async function report() {
  if (!session) return; const id = session.sessionId;
  const value = await api(`/api/regression/sessions/${id}/report`); if (session.sessionId !== id) return; reportValue = value;
  $("reportPanel").hidden = false; const o = value.overview;
  stats("reportOverview", [["已评 / 计划", `${o.evaluated} / ${o.planned}`], ["通过 / 失败", `${o.passed || 0} / ${o.failed}`], ["未评价 / 未完成", `${o.unevaluated} / ${o.unfinished || 0}`], ["人工记录 / 计划", `${o.human.reviewed} / ${o.human.planned}`], ["素材 / 来源组", `${o.uniqueSources || 0} / ${o.sourceGroups || 0}`]]);
  $("reportGroups").replaceChildren(table(["预期行为", "证据模式", "通过", "失败", "已评 / 计划", "未评价"], o.groups.map(g => [g.expectedBehavior, modeNames[g.evidenceMode], g.passed, g.failed, `${g.evaluated} / ${g.attempts}`, g.unevaluated])));
  $("comparison").replaceChildren();
  $("referenceState").textContent = value.reference ? `当前参考 ${value.reference.referenceSessionId} · ${value.reference.selectedAt}` : "未指定参考；可以直接查看自动报告。";
  if (value.reference) $("reference").value = value.reference.referenceSessionId;
  if (value.comparison) {
    const c = value.comparison; $("comparison").append(node("p", `共同 ${c.commonCases.length} / 新增 ${c.newCases.length} / 缺失 ${c.missingCases.length}`));
    for (const warning of c.warnings) $("comparison").append(node("p", warning, "error"));
    const classes = { new_failure: "本次新增失败", recovered: "本次恢复", persistent_failure: "持续存在失败", unchanged: "已观测结果相同", unavailable: "未评价，无法判断", not_comparable: "条件不匹配，无法配对" };
    $("comparison").append(table(["共同案例", "差异", "本轮通过 / 次数", "参考通过 / 次数", "条件"], c.cases.map(c => [c.caseId, classes[c.classification], `${c.current.passed} / ${c.current.attempts}`, `${c.reference.passed} / ${c.reference.attempts}`, c.reasons.join("; ") || "可配对"])));
    $("comparison").append(node("p", `新增：${c.newCases.join("、") || "无"}；缺失：${c.missingCases.join("、") || "无"}`, "muted"));
  }
  $("protocols").textContent = JSON.stringify({ current: value.protocol, reference: value.reference, budget: value.budget, costsAndTime: value.costsAndTime, reviewContext: value.reviewContext, sessionReviews: value.sessionReviews }, null, 2);
  $("downloadReport").href = `/api/regression/sessions/${id}/report`; $("downloadReport").download = `${id}-report.json`;
}
function table(headers, rows) { const t = node("table"), head = node("thead"), tr = node("tr"), body = node("tbody"); for (const h of headers) tr.append(node("th", h)); head.append(tr); for (const row of rows) { const tr = node("tr"); for (const text of row) tr.append(node("td", String(text))); body.append(tr); } t.append(head, body); return t; }
function renderCaseData(a) {
  currentAttempt = a; $("casePanel").hidden = false; $("caseTitle").textContent = `${a.caseId} · 第 ${a.repetition} 次`;
  $("caseState").textContent = `${stateNames[a.state]} · ${verdictNames[a.automatic]} · ${modeNames[a.evidenceMode]}`;
  $("caseRequirement").textContent = `${a.item.brief.instruction} · ${a.item.brief.aspect} · 目标上限 ${a.item.brief.target}s · ${a.item.brief.audio} · 字幕 ${a.item.brief.captions ? "开启" : "关闭"}`;
  $("caseError").textContent = a.reason || a.result?.trace?.outcome?.reason || "";
  const mediaBase = `/media/${session.sessionId}/${a.attemptId}`;
  const output = $("outputVideo"); output.hidden = !a.result?.outputPath; $("outputMissing").textContent = a.result?.outputPath ? "" : "未记录输出；请查看预期行为、原因与自动证据。";
  if (a.result?.outputPath && output.getAttribute("src") !== mediaBase + "/output") output.src = mediaBase + "/output";
  if (!a.result?.outputPath) output.removeAttribute("src");
  if ($("sourceVideo").getAttribute("src") !== mediaBase + "/source") $("sourceVideo").src = mediaBase + "/source";
  $("caseEvidence").textContent = JSON.stringify({ expected: a.item.expected, checks: a.item.checks, observed: a.result?.evidence ?? "未记录", scores: a.result?.scores ?? "未记录", identity: a.identity }, null, 2);
  $("executions").textContent = JSON.stringify(a.result?.trace?.toolExecutions ?? "未记录，不能由工具选择推断执行", null, 2);
  $("modelCalls").textContent = JSON.stringify({ calls: a.result?.trace?.modelCalls ?? "未记录", decisions: a.result?.trace?.toolDecisions ?? "未记录", budget: a.result?.trace?.budget ?? session.budget }, null, 2);
}
async function reviewFields() {
  const records = await api(`/api/regression/sessions/${session.sessionId}/reviews`);
  const scope = $("reviewScope").value;
  const existing = records.current.find(r => r.scope === scope && (scope === "session" || r.attemptId === currentAttempt.attemptId));
  const hasReference = !!reportValue?.reference;
  const choices = hasReference ? [["unknown", "无法判断"], ["better", "新版更好"], ["same", "相当"], ["worse", "新版更差"]] : [["unknown", "无法判断"], ["usable", "可用"], ["needs_changes", "需修改"], ["unusable", "不可用"]];
  $("verdict").replaceChildren(...choices.map(([v, text]) => option(v, text)));
  if (choices.some(([v]) => v === existing?.verdict)) $("verdict").value = existing.verdict;
  $("severity").value = existing?.severity || ""; $("atSeconds").value = existing?.atSeconds ?? ""; $("atSeconds").disabled = scope === "session"; $("note").value = existing?.note || "";
  for (const box of document.querySelectorAll('input[name="label"]')) box.checked = existing?.labels.includes(box.value) || false;
  $("reviewState").textContent = existing ? `已保存 ${existing.updatedAt}${existing.referenceSessionId && existing.referenceSessionId !== reportValue?.reference?.referenceSessionId ? " · 绑定旧参考" : ""}` : "尚未评价，可以直接跳过。";
}
async function openCase(id) { const a = session.attempts.find(a => a.attemptId === id); if (!a) return; await report(); renderCaseData(a); $("reviewScope").value = "attempt"; await reviewFields(); $("casePanel").scrollIntoView({ block: "start" }); }
async function saveReview() {
  const labels = [...document.querySelectorAll('input[name="label"]:checked')].map(b => b.value), verdict = $("verdict").value;
  if (["worse", "needs_changes", "unusable"].includes(verdict) && !labels.length) throw new Error("负面评价请至少选择一个问题标签，无需长说明。");
  const scope = $("reviewScope").value;
  const body = { scope, verdict, labels, ...(scope === "attempt" ? { attemptId: currentAttempt.attemptId } : {}) };
  if ($("severity").value) body.severity = $("severity").value;
  if ($("atSeconds").value !== "" && scope === "attempt") body.atSeconds = Number($("atSeconds").value);
  if ($("note").value.trim()) body.note = $("note").value.trim();
  const value = await api(`/api/regression/sessions/${session.sessionId}/reviews`, body, "PUT"); $("reviewState").textContent = `已保存 ${value.updatedAt}`; await report();
}
async function load() {
  data = await api("/api/regression/dataset"); $("datasetState").textContent = `${data.cases.length} 条 · 源素材已校验`;
  $("category").append(...data.categories.map(c => option(c, categoryNames[c]))); $("tag").append(...data.tags.map(t => option(t, t)));
  $("caseIds").append(...data.cases.map(c => option(c.caseId, `${categoryNames[c.category]} · ${c.caseId}`)));
  $("provider").append(...data.providers.map(p => option(p.id, p.label)));
  const prior = saved(); for (const [id, value] of Object.entries(prior.settings || {})) if ($(id) && !["textModel", "visionModel"].includes(id)) $(id).value = value;
  if (!$("provider").value) $("provider").selectedIndex = 0;
  await preview(); await history();
  const legacy = await api("/api/regression/history");
  $("legacyHistory").replaceChildren(...legacy.map(s => { const row = node("div", undefined, "row"), button = node("button", "读取旧报告", "secondary"); row.append(node("span", `${s.startedAt} · ${s.kind} · 缺失字段显示未记录`)); button.onclick = runAction(async () => { const value = await api(`/api/regression/legacy/${s.sessionId}`); $("legacyReport").textContent = value.report; }); row.append(button); return row; }));
  if (prior.sessionId) await openSession(prior.sessionId);
  availability();
}
for (const mode of ["quick", "targeted", "full"]) $(mode).onclick = runAction(() => changeMode(mode));
for (const id of ["category", "tag", "caseIds", "historicalFailures", "seed", "repeatCase", "repeatCount"]) $(id).onchange = runAction(preview);
for (const id of ["stopLimitUsd", "maxRequestCostUsd", "concurrency", "timeoutSeconds", "apiKey"]) $(id).oninput = () => { availability(); persist(); };
for (const id of ["textModel", "visionModel"]) $(id).onchange = () => { prices(); availability(); persist(); };
$("provider").onchange = () => { catalog = undefined; for (const id of ["textModel", "visionModel"]) { $(id).replaceChildren(option("", "请重新读取目录")); $(id).disabled = true; } availability(); persist(); };
$("preview").onclick = runAction(preview); $("loadModels").onclick = runAction(loadModels); $("start").onclick = runAction(() => start()); $("continue").onclick = runAction(() => start(true));
$("cancel").onclick = runAction(async () => { session = await api(`/api/regression/sessions/${session.sessionId}/cancel`, {}); renderSession(); });
$("report").onclick = runAction(report); $("refreshHistory").onclick = runAction(async () => { await history(); if (session) await openSession(session.sessionId); });
$("chooseReference").onclick = runAction(async () => { if (!$("reference").value) throw new Error("请选择参考运行"); await api(`/api/regression/sessions/${session.sessionId}/reference`, { referenceSessionId: $("reference").value }); await report(); if (currentAttempt) await reviewFields(); });
$("closeCase").onclick = () => { currentAttempt = undefined; $("casePanel").hidden = true; $("outputVideo").pause(); $("sourceVideo").pause(); };
$("reviewForm").onsubmit = runAction(saveReview); $("reviewScope").onchange = runAction(reviewFields);
$("outputVideo").onerror = () => { $("outputMissing").textContent = "输出暂时无法播放，请核对原始媒体检查证据。"; };
void runAction(load)();
