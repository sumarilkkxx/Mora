"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BadgeCheck, Check, ChevronDown, CircleAlert, Download, Music2, RefreshCw, Upload, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Notice } from "@/components/ui/notice";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { composeCopy, hasStructuredCopy, timeline, type PromotionCopy, type EditPlan } from "@/lib/auto-edit/contract";
import { recommendedPlanIndex } from "@/lib/auto-edit/planning";
import { isActive, requiresReview, type EditRun, type EditSource, type WorkspaceDraft } from "@/lib/auto-edit/workspace";
import { MediaPreview, TaskFeedback } from "./workspace-chrome";
import ui from "../auto-edit-workspace.module.css";

export function SourceStage({ sources, draft, en, locked, configured, uploading, musicUploading, musicError, onChange, onUpload, onMusic, onSubmit }: {
  sources: EditSource[]; draft: WorkspaceDraft; en: boolean; locked: boolean; configured: boolean;
  uploading: boolean; musicUploading: boolean; musicError: string; onChange: (draft: WorkspaceDraft) => void;
  onUpload: (file?: File) => void; onMusic: (file?: File) => void; onSubmit: () => void;
}) {
  const upload = useRef<HTMLInputElement>(null);
  const music = useRef<HTMLInputElement>(null);
  const source = sources.find(row => row.id === draft.sourceId);
  const tr = (zh: string, english: string) => en ? english : zh;
  const patch = (brief: Partial<WorkspaceDraft["brief"]>) => onChange({ ...draft, brief: { ...draft.brief, ...brief } });
  const patchPromotion = (key: keyof NonNullable<WorkspaceDraft["brief"]["promotion"]>, value: string) => patch({
    promotion: { subject: "", audience: "", sellingPoints: "", action: "", ...draft.brief.promotion, [key]: value },
  });
  const sourceTooLong = Boolean(source && source.duration > 300000);
  const missingSubject = !draft.brief.promotion?.subject.trim();
  const blocked = !source || sourceTooLong || missingSubject || !configured || locked || uploading || musicUploading;
  const reason = uploading ? tr("正在上传视频…", "Uploading video…") : musicUploading ? tr("正在上传背景音乐…", "Uploading music…")
    : !source ? tr("请先添加视频素材。", "Add a source video first.") : sourceTooLong ? tr("AI 剪辑支持 5 分钟以内视频，请更换素材。", "AI editing supports videos up to 5 minutes. Replace this source.") : missingSubject ? tr("请填写要推广的商品或服务。", "Enter the product or service to promote.") : !configured ? tr("开始前需要配置文本和画面理解模型。", "Configure text and vision models to begin.") : "";
  return <section className={ui.sourceStage} aria-label={tr("素材与目标", "Source and goal")}>
    <div className={ui.sourceColumns}>
      <div className={ui.previewColumn}>
        <div className={ui.sectionHeader}><h2>{tr(source ? "已选素材" : "添加素材", source ? "Selected video" : "Add a video")}</h2>
          <Button variant="ghost" size="sm" disabled={locked || uploading} onClick={() => upload.current?.click()}><Upload />{tr(source ? "更换" : "上传", source ? "Replace" : "Upload")}</Button></div>
        <MediaPreview key={source?.url ?? "empty"} en={en} src={source?.url} label={tr(source ? "原始视频" : "添加视频，开始制作", source ? "Source video" : "Add a video to begin")} />
        <div className={ui.sourceMeta}><strong title={source?.originalName}>{source?.originalName || tr("尚未选择视频", "No video selected")}</strong>
          <span>{source ? tr(`${(source.duration / 1000).toFixed(1)} 秒 · 原片保存在本机`, `${(source.duration / 1000).toFixed(1)}s · Source stored locally`) : "MP4 / MOV / WebM / MKV / M4V · ≤ 1 GB"}</span></div>
        {sources.length > 1 ? <label className={ui.field}><span>{tr("项目中的其他素材", "Project media")}</span><select disabled={locked || uploading} value={draft.sourceId} onChange={event => onChange({ ...draft, sourceId: event.target.value })}>{sources.map(row => <option key={row.id} value={row.id}>{row.originalName}</option>)}</select></label> : null}
        <input ref={upload} hidden type="file" accept=".mp4,.mov,.webm,.mkv,.m4v" aria-label={tr("上传原始视频", "Upload source video")} onChange={event => { onUpload(event.target.files?.[0]); event.target.value = ""; }} />
        <p className={ui.help}>{tr("AI 将分析采样画面和声音，生成后由你确认文案。", "AI analyzes sampled frames and audio. You review the resulting copy.")}</p>
      </div>
      <div className={ui.settingsColumn}>
        <fieldset disabled={locked || uploading || musicUploading} className={`${ui.fieldset} ${ui.promotionSection}`}>
          <legend><span>{tr("推广对象与目标", "Offer and audience")}</span></legend>
          <div className={ui.promotionGrid}>
            <label className={ui.promotionField}><span>{tr("商品或服务", "Product or service")} <b aria-label={tr("必填", "Required")}>*</b></span><Input required name="promotion-subject" autoComplete="off" maxLength={200} value={draft.brief.promotion?.subject ?? ""} placeholder={tr("例如：门店卷发造型服务", "e.g. Salon styling service")} onChange={event => patchPromotion("subject", event.target.value)} /></label>
            <label className={ui.promotionField}><span>{tr("目标顾客（选填）", "Audience (optional)")}</span><Input name="promotion-audience" autoComplete="off" maxLength={300} value={draft.brief.promotion?.audience ?? ""} placeholder={tr("例如：喜欢蓬松卷发的顾客", "e.g. Customers looking for loose curls")} onChange={event => patchPromotion("audience", event.target.value)} /></label>
            <label className={`${ui.promotionField} ${ui.promotionFieldWide}`}><span>{tr("已确认的卖点（选填）", "Confirmed selling points (optional)")}</span><Textarea name="promotion-sellingPoints" autoComplete="off" rows={2} maxLength={800} value={draft.brief.promotion?.sellingPoints ?? ""} placeholder={tr("例如：素材中可见卷发的层次与蓬松外观", "e.g. Visible layers and volume in the footage")} onChange={event => patchPromotion("sellingPoints", event.target.value)} /></label>
            <label className={`${ui.promotionField} ${ui.promotionFieldWide}`}><span>{tr("期望行动（选填）", "Desired action (optional)")}</span><Input name="promotion-action" autoComplete="off" maxLength={200} value={draft.brief.promotion?.action ?? ""} placeholder={tr("例如：咨询适合自己的卷发造型", "e.g. Enquire about a suitable style")} onChange={event => patchPromotion("action", event.target.value)} /></label>
          </div>
        </fieldset>
        <fieldset disabled={locked || uploading || musicUploading} className={ui.fieldset}><legend>{tr("成片规格", "Output format")}</legend><div className={ui.optionGrid}>
          <label className={ui.field}><span>{tr("目标时长", "Duration")}</span><select value={draft.brief.target} onChange={event => patch({ target: Number(event.target.value) as WorkspaceDraft["brief"]["target"] })}>{[15, 20, 25, 30].map(v => <option key={v} value={v}>{v} {tr("秒", "seconds")}</option>)}</select></label>
          <label className={ui.field}><span>{tr("画面比例", "Aspect ratio")}</span><select value={draft.brief.aspect} onChange={event => patch({ aspect: event.target.value as WorkspaceDraft["brief"]["aspect"] })}>{["9:16", "16:9", "1:1"].map(v => <option key={v}>{v}</option>)}</select></label>
        </div></fieldset>
        <fieldset disabled={locked || uploading || musicUploading} className={ui.fieldset}><legend>{tr("声音与表达", "Sound and style")}</legend><div className={ui.optionGrid}>
          <label className={ui.field}><span>{tr("声音", "Audio")}</span><select value={draft.brief.audio} onChange={event => patch({ audio: event.target.value as WorkspaceDraft["brief"]["audio"] })}><option value="voiceover">{tr("生成新旁白", "New voiceover")}</option><option value="original">{tr("保留原声", "Original audio")}</option><option value="muted">{tr("静音展示", "Muted")}</option></select></label>
          <label className={ui.field}><span>{tr("基础节奏", "Pacing")}</span><select value={draft.brief.style} onChange={event => patch({ style: event.target.value as WorkspaceDraft["brief"]["style"] })}><option value="auto">{tr("智能匹配", "Automatic")}</option><option value="concise">{tr("清晰克制", "Concise")}</option><option value="highlights">{tr("亮点密集", "Highlights")}</option><option value="story">{tr("过程叙事", "Story")}</option></select></label>
        </div><Checkbox className={ui.captionChoice} label={tr("同步生成字幕", "Generate captions")} checked={draft.brief.captions} onChange={event => patch({ captions: event.target.checked })} /></fieldset>
        <details open className={ui.disclosure}><summary><span>{tr("可选设置", "Optional settings")}<small>{draft.brief.instruction.trim() || draft.brief.bgm ? tr("已添加自定义设置", "Custom settings added") : tr("推广目标、背景音乐", "Goal and music")}</small></span><ChevronDown aria-hidden="true" /></summary>
          <div className={ui.disclosureBody}><label className={ui.field}><span>{tr("补充要求（选填）", "Additional direction (optional)")}</span><Textarea disabled={locked} name="promotion-goal" autoComplete="off" rows={3} value={draft.brief.instruction} onChange={event => patch({ instruction: event.target.value })} placeholder={tr("描述卖点、目标人群或期望风格…", "Describe your message, audience or style…")} /><small>{tr("留空将根据素材中可确认的商品或服务生成推广文案。", "Leave blank to use the source as the brief.")}</small></label>
            <div className={ui.musicPicker}><Music2 aria-hidden="true" /><div><strong title={draft.bgmName}>{musicUploading ? tr("正在上传…", "Uploading…") : draft.brief.bgm ? draft.bgmName || tr("已添加背景音乐", "Music added") : tr("背景音乐（选填）", "Music (optional)")}</strong><small>MP3 / WAV / AAC / M4A · ≤ 20 MB</small></div>
              <Button size="sm" variant="outline" disabled={locked || musicUploading} onClick={() => music.current?.click()}>{tr(draft.brief.bgm ? "更换" : "选择", draft.brief.bgm ? "Replace" : "Choose")}</Button>
              {draft.brief.bgm ? <Button size="icon-sm" variant="ghost" disabled={locked || musicUploading} aria-label={tr("移除背景音乐", "Remove music")} onClick={() => onChange({ ...draft, bgmName: "", brief: { ...draft.brief, bgm: undefined } })}><X /></Button> : null}
            </div><input ref={music} hidden type="file" accept=".mp3,.wav,.aac,.m4a" aria-label={tr("选择背景音乐", "Choose music")} onChange={event => { onMusic(event.target.files?.[0]); event.target.value = ""; }} />
            {musicError ? <Notice tone="danger">{musicError}</Notice> : null}
          </div></details>
        {source && draft.brief.target > source.duration / 1000 + .5 ? <p className={ui.help}>{tr("目标比原片更长，可能通过重复或调整镜头速度组织画面。", "The target is longer than the source; shots may repeat or change speed.")}</p> : null}
      </div>
    </div>
    <footer className={ui.stageFooter}><div><p className={ui.help} role="status">{reason || tr("下一步：检查并确认成片文案", "Next: review the video copy")}</p>{!configured ? <Link className={ui.textLink} href="/settings?tab=llm">{tr("前往配置模型", "Configure models")}</Link> : null}</div>
      <Button size="lg" disabled={blocked} onClick={onSubmit}>{tr("分析素材，生成文案", "Analyze and write copy")}<ArrowRight /></Button></footer>
  </section>;
}

export function CopyStage({ draft, run, en, locked, saved, onChange, onBack, onApprove, onRewrite }: { draft: WorkspaceDraft; run: EditRun; en: boolean; locked: boolean; saved: string;
  onChange: (value: PromotionCopy) => void; onBack: () => void; onApprove: () => void; onRewrite: (instruction: string) => void }) {
  const tr = (zh: string, english: string) => en ? english : zh;
  const copy = draft.copy;
  const candidates = run.checkpoint.promotionCandidates ?? [];
  const [rewrite, setRewrite] = useState("");
  return <section className={ui.focusStage}><header className={ui.stageHeader}><h2>{tr("选择文案方向", "Choose a copy direction")}</h2><p>{tr("先比较三个方向，再调整选中的文案。", "Compare three directions, then refine your selection.")}</p></header>
    {candidates.length ? <fieldset className={ui.copyCandidateFieldset} disabled={locked}><legend className="sr-only">{tr("文案方向", "Copy directions")}</legend><div className={ui.copyCandidateGrid}>{candidates.map((candidate, index) => {
      const selected = candidate.id ? candidate.id === copy.id : candidate.voiceover === copy.voiceover;
      return <label className={ui.copyCandidate} data-selected={selected || undefined} key={candidate.id ?? index}>
        <input type="radio" name="copy-direction" checked={selected} onChange={() => onChange(candidate)} />
        <span className={ui.copyCandidateTop}><span>{candidate.strategyLabel || candidate.title}</span>{candidate.recommended ? <small><BadgeCheck size={13} />{tr("系统推荐", "System pick")}</small> : null}</span>
        <strong>{candidate.hook}</strong><p>{candidate.rationale || candidate.angle}</p>
        <span className={ui.copyCandidateMatch}><Check size={14} />{candidate.visualMatch || tr("可由当前素材支撑", "Supported by this footage")}</span>
      </label>;
    })}</div></fieldset> : null}
    <div className={ui.copyEditorHeader}><div><h3>{tr("调整选中文案", "Refine selected copy")}</h3><p>{copy.title || copy.strategyLabel}</p></div></div>
    {hasStructuredCopy(copy) ? <div className={ui.copySections}>
      {([
        ["hook", tr("开场吸引", "Hook"), 240],
        ["body", tr("价值说明", "Value"), 800],
        ["cta", tr("行动引导", "Call to action"), 240],
      ] as const).map(([key, label, limit], index) => <label className={ui.copySection} key={key}>
        <span className={ui.copySectionTitle}><span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><strong>{label}</strong></span>
        <Textarea name={`copy-${key}`} autoComplete="off" rows={key === "body" ? 3 : 2} maxLength={limit} value={copy[key]} disabled={locked} onChange={event => { const next = { ...copy, [key]: event.target.value }; onChange({ ...next, voiceover: composeCopy(next) }); }} />
      </label>)}
    </div> : <label className={ui.field}><span>{tr("已保存的完整文案", "Saved complete copy")}</span><Textarea name="video-copy" className={ui.copyEditor} rows={4} maxLength={1200} value={copy.voiceover} disabled={locked} onChange={event => onChange({ ...copy, voiceover: event.target.value })} /><small>{tr("此版本曾单独修改完整文案，已保留原文；重新生成的文案支持分段编辑。", "This version has separate full-copy edits, preserved here. Newly generated copy supports section editing.")}</small></label>}
    {hasStructuredCopy(copy) && (!copy.hook.trim() || !copy.body.trim() || !copy.cta.trim()) ? <p className={ui.help}>{tr("请补全三段文案后继续。", "Complete all three sections to continue.")}</p> : null}
    {copy.voiceover.length > 1200 ? <Notice tone="warning">{tr("文案总长不能超过 1200 字，请精简后继续。", "Shorten the copy to 1,200 characters to continue.")}</Notice> : null}
    <p className={ui.help} role="status">{copy.voiceover.length} / 1200 · {saved}</p>
    <details className={ui.disclosure}><summary><span>{tr("成片文案预览", "Complete copy preview")}<small>{tr("按以上顺序合并，用于后续剪辑", "Combined in this order for the edit")}</small></span><ChevronDown aria-hidden="true" /></summary><div className={ui.disclosureBody}><p className={ui.copyPreview}>{copy.voiceover || "—"}</p>{copy.angle ? <p className={ui.help}>{tr("推广角度：", "Angle: ")}{copy.angle}</p> : null}</div></details>
    <details className={ui.disclosure}><summary>{tr("素材理解与依据", "Source understanding & evidence")}<ChevronDown aria-hidden="true" /></summary><div className={ui.disclosureBody}>
      <p className={ui.evidenceSummary}>{run.checkpoint.analysis?.summary || tr("暂无理解摘要", "No summary available")}</p>
      <ul className={ui.evidenceList}>{copy.evidence.map((item, i) => <li key={i}>{item}</li>)}</ul>
    </div></details>
    <div className={ui.rewriteBar}><Input aria-label={tr("重写要求", "Rewrite direction")} maxLength={1000} value={rewrite} disabled={locked} onChange={event => setRewrite(event.target.value)} placeholder={tr("带要求重写（选填）", "Rewrite direction (optional)")} />
      <Button variant="outline" disabled={locked} onClick={() => onRewrite(rewrite)}><RefreshCw />{rewrite.trim() ? tr("按要求重写", "Rewrite") : tr("换一批", "New options")}</Button></div>
    {run.checkpoint.analysis?.warnings.length ? <Notice tone="warning" title={tr("理解结果需要留意", "Review the source analysis")}><ul>{run.checkpoint.analysis.warnings.map((item, i) => <li key={i}>{item}</li>)}</ul></Notice> : null}
    <footer className={ui.stageFooter}><Button variant="ghost" onClick={onBack}><ArrowLeft />{tr("返回目标", "Back to goal")}</Button><Button size="lg" disabled={locked || !copy.voiceover.trim() || copy.voiceover.length > 1200 || (hasStructuredCopy(copy) && (!copy.hook.trim() || !copy.body.trim() || !copy.cta.trim()))} onClick={onApprove}>{tr("确认文案，生成方案", "Approve and create plans")}<ArrowRight /></Button></footer>
  </section>;
}

export function PlanStage({ plans, currentPlan, copyStrategy, style, en, locked, onBack, onChoose }: { plans: EditPlan[]; currentPlan?: EditPlan; copyStrategy?: PromotionCopy["strategy"]; style?: WorkspaceDraft["brief"]["style"]; en: boolean; locked: boolean; onBack: () => void; onChoose: (plan: EditPlan) => void }) {
  const [selected, setSelected] = useState(() => currentPlan ? plans.findIndex(plan => JSON.stringify(plan) === JSON.stringify(currentPlan)) : -1);
  const [detailPlan, setDetailPlan] = useState<{ plan: EditPlan; index: number } | null>(null);
  const tr = (zh: string, english: string) => en ? english : zh;
  const recommended = plans.findIndex(plan => plan.recommended) >= 0 ? plans.findIndex(plan => plan.recommended) : recommendedPlanIndex(copyStrategy, style ?? "auto");
  return <section className={ui.focusStage}><header className={ui.stageHeader}><h2>{tr("选择剪辑方案", "Choose your edit")}</h2><p>{tr("先比较镜头顺序与节奏，选定后再开始生成。", "Compare the opening and pacing, then generate your selected plan.")}</p></header>
    <fieldset className={ui.planFieldset} disabled={locked}><legend className="sr-only">{tr("剪辑方案", "Edit plans")}</legend><div className={ui.planGrid}>{plans.map((plan, index) => {
      const clips = timeline(plan); const duration = clips.at(-1)?.outputEnd ?? 0;
      return <article className={ui.planCard} data-selected={selected === index || undefined} key={index}>
        <button className={ui.planSelectionButton} type="button" aria-pressed={selected === index} aria-label={`${selected === index ? tr("取消选择", "Deselect") : tr("选择", "Select")} ${tr("方案", "plan")} ${String(index + 1).padStart(2, "0")} · ${plan.title}`} onClick={() => setSelected(current => current === index ? -1 : index)} />
        {index === recommended ? <span className={ui.planRecommendation}><BadgeCheck size={13} />{tr("系统推荐", "System pick")}</span> : null}
        <div className={ui.planSelect}><span className={ui.planRadio} aria-hidden="true" /><span><small>{tr("方案", "Plan")} {String(index + 1).padStart(2, "0")}</small><strong>{plan.title}</strong></span></div>
        <p>{plan.clips[0]?.reason || plan.explanation}</p><div className={ui.planStats}><span>{clips.length} {tr("个镜头", "shots")}</span><span>{duration.toFixed(1)}s</span><span>{tr("平均", "Avg.")} {(duration / Math.max(1, clips.length)).toFixed(1)}s</span></div>
        <div className={ui.timeline} aria-hidden="true">{clips.map((clip, i) => <span key={i} style={{ flexGrow: Math.max(.1, clip.outputEnd - clip.outputStart) }} />)}</div>
        <div className={ui.planOpening}><small>{tr("开场画面", "Opening shot")}</small><p>{plan.clips[0]?.evidence || tr("按原片内容编排", "Based on the source")}</p></div>
        <Button className={ui.planDetailsButton} variant="ghost" size="sm" onClick={() => setDetailPlan({ plan, index })}>{tr("查看镜头详情", "View shot details")}<ArrowRight size={14} /></Button>
      </article>;
    })}</div></fieldset>
    <Dialog open={Boolean(detailPlan)} onOpenChange={open => { if (!open) setDetailPlan(null); }}><DialogContent className={ui.shotDialog}>
      <div className={ui.shotDialogHeader}><DialogTitle>{detailPlan ? `${tr("方案", "Plan")} ${String(detailPlan.index + 1).padStart(2, "0")} · ${detailPlan.plan.title}` : tr("镜头详情", "Shot details")}</DialogTitle><DialogDescription>{tr("按成片时间查看镜头顺序、原片区间与画面依据。", "Review the sequence, source range and visual evidence.")}</DialogDescription></div>
      <ol className={ui.shotDialogList}>{detailPlan ? timeline(detailPlan.plan).map((clip, i) => <li key={i}><div className={ui.shotDialogMeta}><strong>{tr("镜头", "Shot")} {String(i + 1).padStart(2, "0")}</strong><time>{clip.outputStart.toFixed(1)}–{clip.outputEnd.toFixed(1)}s</time><span>{tr("原片", "Source")} {clip.start.toFixed(1)}–{clip.end.toFixed(1)}s</span></div>{clip.text ? <p>{clip.text}</p> : null}<small>{clip.evidence}</small></li>) : null}</ol>
    </DialogContent></Dialog>
    <footer className={ui.stageFooter}><Button variant="ghost" onClick={onBack}><ArrowLeft />{tr("返回文案", "Back to copy")}</Button><div className={ui.confirmPlan}><span>{selected >= 0 ? plans[selected]?.title : tr("请选择一个方案", "Select a plan")}</span><Button size="lg" disabled={locked || selected < 0 || !plans[selected]} onClick={() => onChoose(plans[selected])}>{tr("按此方案生成成片", "Generate selected plan")}<ArrowRight /></Button></div></footer>
  </section>;
}

export function ResultStage({ run, exportRun, en, locked, onBack, onExport, onRetry, onCancel }: {
  run: EditRun; exportRun?: EditRun; en: boolean; locked: boolean; onBack: () => void; onExport: () => void; onRetry: (run: EditRun) => void; onCancel: (run: EditRun) => void;
}) {
  const tr = (zh: string, english: string) => en ? english : zh;
  const review = requiresReview(run);
  const checks = run.checkpoint.checks;
  return <section className={ui.resultStage} aria-label={tr("成片预览与导出", "Video preview and export")}>
    <header className={ui.resultHeader}><div><span className={review ? ui.reviewLabel : ui.successLabel}>{review ? <CircleAlert size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}{tr(review ? "成片已生成 · 待复核" : "成片已生成", review ? "Video ready · needs review" : "Your video is ready")}</span><h2>{run.checkpoint.plan?.title || tr("推广成片", "Video")}</h2></div><span className={ui.resultQuality}>{run.quality}</span></header>
    <MediaPreview key={run.url} en={en} result src={run.url} label={tr("成片预览", "Video preview")} />
    <div className={ui.resultInfo}><dl><div><dt>{tr("时长", "Duration")}</dt><dd>{checks?.duration != null ? `${checks.duration.toFixed(2)}s` : "—"}</dd></div><div><dt>{tr("比例", "Aspect")}</dt><dd>{run.brief.aspect}</dd></div><div><dt>{tr("画质", "Quality")}</dt><dd>{run.quality}</dd></div></dl>
      <div className={ui.resultActions}><a className={buttonVariants({ size: "lg" })} href={`${run.url}?download=1`}><Download />{tr(`下载 ${run.quality} 视频`, `Download ${run.quality}`)}</a>
        {exportRun?.url ? <a className={buttonVariants({ variant: "outline", size: "lg" })} href={`${exportRun.url}?download=1`}><Download />{tr("下载 1080p 版本", "Download 1080p")}</a>
          : run.quality !== "1080p" ? <Button variant="outline" size="lg" disabled={locked || Boolean(exportRun)} onClick={onExport}>{tr(isActive(exportRun) ? "正在生成 1080p…" : "生成 1080p 版本", isActive(exportRun) ? "Generating 1080p…" : "Generate 1080p")}</Button> : null}
        <Button variant="ghost" onClick={onBack}>{tr("其他剪辑方案", "Other edit plans")}</Button>
      </div></div>
    {review ? <Notice tone="warning" title={tr("下载前请检查", "Review before sharing")}><ul>{[...(checks?.issues ?? []), ...(checks?.review ?? [])].map((item, i) => <li key={i}>{item}</li>)}</ul>{!checks?.review.length && !checks?.issues.length ? tr("请播放成片，确认画面、声音和字幕。", "Play the video to check picture, sound and captions.") : null}</Notice> : null}
    {exportRun && !exportRun.url ? <TaskFeedback compact run={exportRun} en={en} busy={locked && !isActive(exportRun)} onRetry={() => onRetry(exportRun)} onCancel={() => onCancel(exportRun)} /> : null}
    {exportRun?.url && requiresReview(exportRun) ? <Notice tone="warning" title={tr("高清版本仍有待复核事项", "Review the HD version")}><ul>{[...(exportRun.checkpoint.checks?.review ?? []), ...(exportRun.checkpoint.checks?.issues ?? [])].map((item, i) => <li key={i}>{item}</li>)}</ul></Notice> : null}
    <details className={ui.disclosure}><summary>{tr("检查结果", "Output checks")}<ChevronDown aria-hidden="true" /></summary><p className={ui.disclosureBody}>{checks?.technical ? tr("技术检查已通过。请自行确认表达、字幕和画面效果。", "Technical checks passed. Review the message, captions and picture yourself.") : tr("尚无通过技术检查的记录。", "No passed technical check is recorded.")}</p></details>
  </section>;
}
