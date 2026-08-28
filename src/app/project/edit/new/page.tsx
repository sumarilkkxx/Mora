"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LuArrowLeft, LuFileVideo, LuLoaderCircle, LuScissors, LuUpload } from "react-icons/lu";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { PageFrame, PageHeader, Surface } from "@/components/studio/page";
import { useLocale, useT } from "@/lib/i18n";

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
      router.push(`/project/${project.id}/edit`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("createFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageFrame width="content">
      <PageHeader
        eyebrow={t("createEyebrow")}
        title={t("createTitle")}
        description={t("createDescription")}
        actions={<Link href="/start"><Button variant="ghost"><LuArrowLeft />{t("backProjects")}</Button></Link>}
      />
      <Surface className="mx-auto max-w-2xl p-5 sm:p-7">
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="space-y-2 text-sm font-medium">
            <span>{t("projectName")}</span>
            <Input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder={t("projectNamePlaceholder")} />
          </label>
          <label className="space-y-2 text-sm font-medium">
            <span>{t("productName")}</span>
            <Input value={productName} onChange={(event) => setProductName(event.target.value)} placeholder={t("productNamePlaceholder")} />
          </label>
        </div>
        <div className="mt-6">
          <div className="mb-2 flex items-end justify-between gap-3">
            <div><p className="text-sm font-medium">{t("sourceVideo")}</p><p className="mt-1 text-xs text-muted-foreground">{t("sourceVideoHint")}</p></div>
            {file ? <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>{t("replaceVideo")}</Button> : null}
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex min-h-48 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-primary/35 bg-primary/[.035] px-6 text-center transition-[border-color,background-color,transform] hover:border-primary/65 hover:bg-primary/[.06] active:scale-[.995] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20"
          >
            {file ? <LuFileVideo className="mb-3 size-9 text-primary" /> : <LuUpload className="mb-3 size-9 text-primary" />}
            <span className="text-sm font-semibold">{file?.name || t("chooseVideo")}</span>
            {file ? <span className="mt-1 text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</span> : null}
          </button>
          <input ref={inputRef} hidden type="file" accept={ACCEPT} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </div>
        {error ? <Notice tone="danger" className="mt-5">{error}</Notice> : null}
        <Button size="lg" className="mt-6 w-full" disabled={!file || busy} onClick={() => void createProject()}>
          {busy ? <LuLoaderCircle className="animate-spin motion-reduce:animate-none" /> : <LuScissors />}
          {busy ? t("creatingProject") : t("createProject")}
        </Button>
      </Surface>
    </PageFrame>
  );
}

