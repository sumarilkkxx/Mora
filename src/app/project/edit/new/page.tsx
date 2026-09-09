"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LuArrowLeft, LuBrainCircuit, LuCheck, LuFileVideo, LuLoaderCircle, LuScissors, LuSlidersHorizontal, LuUpload } from "react-icons/lu";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { PageFrame, PageHeader } from "@/components/studio/page";
import { useLocale, useT } from "@/lib/i18n";

import styles from "./page.module.css";

const ACCEPT = ".mp4,.mov,.webm,.mkv,.m4v,video/mp4,video/quicktime,video/webm";

export default function NewGuidedEditPage() {
  const router = useRouter();
  const t = useT("guidedEdit");
  const locale = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [projectName, setProjectName] = useState("");
  const [productName, setProductName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [aiEdit, setAiEdit] = useState(true);

  async function createProject() {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      const projectResponse = await fetch("/api/project", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept-Language": locale },
        body: JSON.stringify({
          name: projectName.trim() || productName.trim() || file.name.replace(/\.[^.]+$/, ""),
          productName: productName.trim(),
          workflowType: "edit",
        }),
      });
      const project = await projectResponse.json();
      if (!projectResponse.ok || !project.id) throw new Error(project.error || t("createFailed"));
      const uploadResponse = await fetch(`/api/project/${project.id}/media`, {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-File-Name": encodeURIComponent(file.name),
          "Accept-Language": locale,
        },
        body: file,
      });
      const uploaded = await uploadResponse.json();
      if (!uploadResponse.ok || !uploaded.id) throw new Error(uploaded.error || t("createFailed"));
      router.push(`/project/${project.id}/${aiEdit ? "auto-edit" : "edit"}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("createFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageFrame width="wide" className={styles.page}>
      <PageHeader
        eyebrow={t("createEyebrow")}
        title={t("createTitle")}
        description={t("createDescription")}
        actions={<Link href="/start"><Button variant="ghost"><LuArrowLeft />{t("backProjects")}</Button></Link>}
      />
      <section className={styles.creator} aria-labelledby="workflow-choice-title">
        <div className={styles.sectionHeading}>
          <h2 id="workflow-choice-title">{t("workflowChoice")}</h2>
          <p>{t("workflowChoiceHint")}</p>
        </div>
        <div className={styles.choices} data-workflow={aiEdit ? "ai" : "local"} role="tablist" aria-labelledby="workflow-choice-title">
          {[true, false].map((isAi) => {
            const selected = aiEdit === isAi;
            const prefix = isAi ? "workflowAi" : "workflowLocal";
            const Icon = isAi ? LuBrainCircuit : LuSlidersHorizontal;
            return (
              <button
                key={prefix}
                type="button"
                id={isAi ? "workflow-tab-ai" : "workflow-tab-local"}
                role="tab"
                aria-selected={selected}
                aria-controls="workflow-panel"
                tabIndex={selected ? 0 : -1}
                className={styles.choice}
                onClick={() => setAiEdit(isAi)}
                onKeyDown={(event) => {
                  if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) {
                    event.preventDefault();
                    const next = event.key === "Home" ? true : event.key === "End" ? false : !isAi;
                    setAiEdit(next);
                    document.getElementById(next ? "workflow-tab-ai" : "workflow-tab-local")?.focus();
                  }
                }}
              >
                <span className={styles.choiceTop}>
                  <span className={styles.icon}><Icon aria-hidden="true" /></span>
                  <span className={styles.choiceTitle}>{t(`${prefix}Title`)}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div id="workflow-panel" role="tabpanel" tabIndex={0} aria-labelledby={aiEdit ? "workflow-tab-ai" : "workflow-tab-local"} className={styles.form}>
        <div className={styles.formHeading}>
          <span className={styles.currentWorkflow}><LuCheck aria-hidden="true" />{t("selectedWorkflow", { name: aiEdit ? t("workflowAiTitle") : t("workflowLocalTitle") })}</span>
          <span>{aiEdit ? t("workflowAiLimit") : t("workflowLocalLimit")}</span>
        </div>
        <p className={styles.workflowDescription}>{aiEdit ? t("workflowAiDescription") : t("workflowLocalDescription")}</p>
        <div className={styles.fields}>
          <label className={styles.field}>
            <span>{t("projectName")}</span>
            <Input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder={t("projectNamePlaceholder")} />
          </label>
          <label className={styles.field}>
            <span>{t("productName")}</span>
            <Input value={productName} onChange={(event) => setProductName(event.target.value)} placeholder={t("productNamePlaceholder")} />
          </label>
        </div>
        <div className={styles.uploadSection}>
          <div className={styles.uploadHeading}>
            <p>{t("sourceVideo")}</p>
            {file ? <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>{t("replaceVideo")}</Button> : null}
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={styles.upload}
          >
            <span className={styles.uploadIcon}>
              {file ? <LuFileVideo className="size-5" /> : <LuUpload className="size-5" />}
            </span>
            <span className={styles.uploadCopy}>
              <span className={styles.uploadTitle}>{file?.name || t("chooseVideo")}</span>
              <span className={styles.uploadHint}>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : t("sourceVideoHint")}</span>
            </span>
          </button>
          <input ref={inputRef} hidden type="file" accept={ACCEPT} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </div>
        {error ? <Notice tone="danger" className="mt-5">{error}</Notice> : null}
        <div className={styles.footer}>
          <Button size="lg" className={styles.submit} disabled={!file || busy} onClick={() => void createProject()}>
            {busy ? <LuLoaderCircle className="animate-spin motion-reduce:animate-none" /> : <LuScissors />}
            {busy ? t("creatingProject") : aiEdit ? t("createAiProject") : t("createLocalProject")}
          </Button>
        </div>
        </div>
      </section>
    </PageFrame>
  );
}
