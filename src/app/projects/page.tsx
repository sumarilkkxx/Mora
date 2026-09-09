"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { LuArrowUpRight, LuClock3, LuDownload, LuFilm, LuFolderOpen, LuImage, LuLayers3, LuPlay, LuPlus, LuRotateCcw, LuSearch, LuSparkles, LuTrash2 } from "react-icons/lu";
import { useT, useLocale } from "@/lib/i18n";
import { formatRelativeTime } from "@/lib/relative-time";
import { PageFrame, PageHeader, SegmentedControl, SegmentedItem, Skeleton } from "@/components/studio/page";
import { projectContinuePath, type ProductionMode } from "@/lib/production-mode";

import styles from "./page.module.css";

interface ProjectRow {
  thumbnailUrl?: string | null;
  id: string;
  name: string;
  productName: string | null;
  productImages?: string[] | null;
  status: string;
  workflowType?: "generate" | "edit";
  productionMode?: ProductionMode;
  sourceType?: "manual" | "clone";
  contentType?: "product" | "topic";
  deletedAt?: string | null;
  updatedAt: string | null;
}

interface WorkRow {
  id: string;
  projectId: string;
  projectName: string | null;
  productName: string | null;
  label: string | null;
  duration: number | null;
  createdAt: string | null;
  url: string;
  thumbnailUrl: string | null;
}

// project status → common.status* i18n key
function statusKeyFor(status: string): string {
  switch (status) {
    case "done": return "statusDone";
    case "composing": return "statusComposing";
    case "video": return "statusVideo";
    case "assets": return "statusAssets";
    case "scripting": return "statusScripting";
    default: return "statusDraft";
  }
}

/**
 * Project library with two views:
 * - Projects: every project, searchable, resuming at the right step — now with a poster
 *   (latest render's first frame, falling back to the product photo) and a delete entrance.
 * - Works: the cross-project feed of finished videos, newest first, found by their pictures
 *   instead of by opening N export pages one by one.
 */
export default function ProjectsPage() {
  const t = useT("projectsPage");
  const tc = useT("common");
  const locale = useLocale();
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [trashRows, setTrashRows] = useState<ProjectRow[]>([]);
  const [works, setWorks] = useState<WorkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"projects" | "works" | "trash">("projects");
  const [sourceFilter, setSourceFilter] = useState<"all" | "edit" | "generate" | "clone" | "topic">("all");
  const [selectedTrash, setSelectedTrash] = useState<Set<string>>(() => new Set());
  const [mutating, setMutating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [projRes, trashRes, workRes] = await Promise.all([
          fetch("/api/project"),
          fetch("/api/project?trash=1"),
          fetch("/api/works").catch(() => null),
        ]);
        if (!projRes.ok || !trashRes.ok) throw new Error(String(projRes.status));
        const [data, trashData] = await Promise.all([projRes.json(), trashRes.json()]);
        const list: ProjectRow[] = Array.isArray(data) ? data : [];
        const ts = (p: ProjectRow) => {
          if (!p.updatedAt) return 0;
          const time = new Date(p.updatedAt).getTime();
          return Number.isFinite(time) ? time : 0;
        };
        if (!cancelled) setRows([...list].sort((a, b) => ts(b) - ts(a)));
        if (!cancelled) setTrashRows(Array.isArray(trashData) ? trashData as ProjectRow[] : []);
        if (workRes?.ok) {
          const w = await workRes.json().catch(() => ({}));
          if (!cancelled && Array.isArray(w?.works)) setWorks(w.works as WorkRow[]);
        }
      } catch {
        if (!cancelled) setLoadError(t("loadError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch once; t is stable per locale
  }, []);

  // works are newest-first → first occurrence per project = its latest poster
  const posterByProject = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of works) {
      if (w.thumbnailUrl && !m.has(w.projectId)) m.set(w.projectId, w.thumbnailUrl);
    }
    return m;
  }, [works]);

  // A persisted render is stronger evidence than a stale pipeline status. Keep an
  // actively composing project active, but repair older draft/scripting rows once
  // the backend has already saved a finished work for that project.
  const completedProjectIds = useMemo(
    () => new Set(works.filter((work) => Boolean(work.url)).map((work) => work.projectId)),
    [works]
  );

  const effectiveStatusFor = (project: ProjectRow) => (
    project.status !== "composing" && completedProjectIds.has(project.id)
      ? "done"
      : project.status
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((p) => {
      const matchesQuery = !q || (p.name || "").toLowerCase().includes(q) || (p.productName || "").toLowerCase().includes(q);
      const matchesSource = sourceFilter === "all"
        || (sourceFilter === "edit" && p.workflowType === "edit")
        || (sourceFilter === "clone" && p.sourceType === "clone")
        || (sourceFilter === "topic" && p.contentType === "topic")
        || (sourceFilter === "generate" && p.workflowType !== "edit" && p.sourceType !== "clone" && p.contentType !== "topic");
      return matchesQuery && matchesSource;
    });
  }, [rows, query, sourceFilter]);

  const sourceCounts = useMemo(() => ({
    all: rows.length,
    edit: rows.filter((p) => p.workflowType === "edit").length,
    clone: rows.filter((p) => p.sourceType === "clone").length,
    topic: rows.filter((p) => p.contentType === "topic").length,
    generate: rows.filter((p) => p.workflowType !== "edit" && p.sourceType !== "clone" && p.contentType !== "topic").length,
  }), [rows]);

  const sourceLabel = (p: ProjectRow) => p.workflowType === "edit" ? t("sourceEdit")
    : p.sourceType === "clone" ? t("sourceClone")
      : p.contentType === "topic" ? t("sourceTopic") : t("sourceGenerate");

  const sourceIcon = (p: ProjectRow) => p.workflowType === "edit" ? LuFilm
    : p.sourceType === "clone" ? LuLayers3 : LuSparkles;

  // Default delete is recoverable: move the project to trash without touching its files.
  const handleDelete = async (p: ProjectRow) => {
    try {
      const res = await fetch(`/api/project/${p.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      setRows((prev) => prev.filter((r) => r.id !== p.id));
      setTrashRows((prev) => [{ ...p, thumbnailUrl: posterByProject.get(p.id) ?? p.thumbnailUrl, deletedAt: new Date().toISOString() }, ...prev]);
      setWorks((prev) => prev.filter((w) => w.projectId !== p.id));
    } catch {
      window.alert(t("deleteFailed"));
    }
  };

  const mutateTrash = async (action: "restore" | "delete", ids: string[]) => {
    if (!ids.length) return;
    if (action === "delete" && !window.confirm(t("permanentDeleteConfirm", { n: ids.length }))) return;
    setMutating(true);
    try {
      const res = await fetch("/api/project/trash", {
        method: action === "restore" ? "PATCH" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const affected = trashRows.filter((p) => ids.includes(p.id));
      setTrashRows((prev) => prev.filter((p) => !ids.includes(p.id)));
      if (action === "restore") setRows((prev) => [...affected.map((p) => ({ ...p, deletedAt: null })), ...prev]);
      setSelectedTrash(new Set());
    } catch {
      window.alert(t(action === "restore" ? "restoreFailed" : "deleteFailed"));
    } finally { setMutating(false); }
  };

  return (
      <PageFrame width="wide">
        {/* Page header: title + primary action, same pattern as the other library pages */}
        <PageHeader
          title={t("pageTitle")}
          description={t("pageSubtitle")}
          actions={<Link href="/start">
            <Button>
              <LuPlus className="h-4 w-4" />
              <span className="ml-1.5">{t("newProject")}</span>
            </Button>
          </Link>}
        />

        {/* One calm command surface keeps view, search and source filtering together. */}
        <div className="mb-6 overflow-hidden rounded-2xl border border-border/65 bg-card/80 shadow-[0_12px_34px_rgba(45,76,110,.06)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center gap-3 border-b border-border/55 px-3 py-3 sm:px-4">
            <SegmentedControl>
              {(["projects", "works", "trash"] as const).map((v) => (
                <SegmentedItem key={v} onClick={() => setView(v)} selected={view === v}>
                  {t(v === "projects" ? "tabProjects" : v === "works" ? "tabWorks" : "tabTrash")}
                  <span className="ml-1 text-[10px] opacity-60">{v === "projects" ? rows.length : v === "works" ? works.length : trashRows.length}</span>
                </SegmentedItem>
              ))}
            </SegmentedControl>
            {view === "projects" && rows.length > 0 ? (
              <div className="relative ml-auto min-w-[220px] flex-1 sm:max-w-sm">
                <LuSearch className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchPlaceholder")} className="h-9 pl-9 text-sm" />
              </div>
            ) : null}
            {view === "trash" && trashRows.length > 0 ? <div className="ml-auto flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={mutating || selectedTrash.size === 0} onClick={() => void mutateTrash("restore", [...selectedTrash])}><LuRotateCcw />{t("restoreSelected", { n: selectedTrash.size })}</Button><Button size="sm" variant="destructive" className={styles.deleteButton} disabled={mutating || selectedTrash.size === 0} onClick={() => void mutateTrash("delete", [...selectedTrash])}><LuTrash2 />{t("deleteSelected", { n: selectedTrash.size })}</Button></div> : null}
          </div>
          {view === "projects" && rows.length > 0 ? (
            <div className="flex gap-1 overflow-x-auto px-3 py-2.5 sm:px-4" role="tablist" aria-label={t("sourceFilter")}>
              {(["all", "edit", "generate", "clone", "topic"] as const).map((source) => (
                <button
                  key={source}
                  type="button"
                  role="tab"
                  aria-selected={sourceFilter === source}
                  onClick={() => setSourceFilter(source)}
                  className={`inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-[background-color,color,box-shadow,transform] active:scale-[.98] ${sourceFilter === source ? "bg-primary text-primary-foreground shadow-[0_4px_12px_rgba(0,113,227,.18)]" : "text-muted-foreground hover:bg-muted/45 hover:text-foreground"}`}
                >
                  {t(source === "all" ? "sourceAll" : source === "edit" ? "sourceEdit" : source === "generate" ? "sourceGenerate" : source === "clone" ? "sourceClone" : "sourceTopic")}
                  <span className={`text-[10px] ${sourceFilter === source ? "text-primary-foreground/75" : "text-muted-foreground/60"}`}>{sourceCounts[source]}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={tc("loading")}>
            {[0, 1, 2, 3, 4, 5].map((item) => (
              <div key={item} className="studio-surface overflow-hidden">
                <Skeleton className="aspect-video rounded-none" />
                <div className="space-y-2 p-4">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : loadError ? (
          <Notice tone="danger">{loadError}</Notice>
        ) : view === "trash" ? (
          trashRows.length === 0 ? <Card className="glass-card"><CardContent className="flex flex-col items-center gap-3 py-14 text-center"><LuTrash2 className="h-8 w-8 text-muted-foreground/60" /><div><p className="font-medium">{t("trashEmpty")}</p><p className="mt-1 text-sm text-muted-foreground">{t("trashEmptyDesc")}</p></div></CardContent></Card> : <>
            <label className="mb-3 inline-flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={selectedTrash.size === trashRows.length} onChange={(event) => setSelectedTrash(event.target.checked ? new Set(trashRows.map((p) => p.id)) : new Set())} />{t("selectAll")}</label>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{trashRows.map((p) => {
              const checked = selectedTrash.has(p.id);
              const poster = posterByProject.get(p.id) ?? p.thumbnailUrl ?? (p.productImages?.[0] || null);
              return <Card key={p.id} className={`glass-card gap-0 overflow-hidden py-0 ${checked ? "ring-2 ring-primary/35" : ""}`}><CardContent className="p-0"><div className="relative aspect-video bg-muted/30">{poster ? <Image src={poster} alt="" width={640} height={360} unoptimized className="h-full w-full object-cover" /> : <div className="absolute inset-0 flex items-center justify-center"><LuImage className="h-7 w-7 text-muted-foreground/40" /></div>}<label className="absolute left-2 top-2 grid size-7 place-items-center rounded-lg bg-card/90 shadow-sm"><input type="checkbox" checked={checked} onChange={(event) => setSelectedTrash((current) => { const next = new Set(current); if (event.target.checked) next.add(p.id); else next.delete(p.id); return next; })} aria-label={t("selectProject", { name: p.name })} /></label></div><div className="p-4"><p className="truncate text-sm font-medium">{p.name || p.productName || t("untitled")}</p><p className="mt-1 text-xs text-muted-foreground">{sourceLabel(p)}</p><div className="mt-4 flex gap-2"><Button size="sm" variant="outline" className="flex-1" disabled={mutating} onClick={() => void mutateTrash("restore", [p.id])}><LuRotateCcw />{t("restore")}</Button><Button size="sm" variant="destructive" className={styles.deleteButton} disabled={mutating} onClick={() => void mutateTrash("delete", [p.id])}><LuTrash2 />{t("permanentDelete")}</Button></div></div></CardContent></Card>;
            })}</div>
          </>
        ) : view === "works" ? (
          works.length === 0 ? (
            <Card className="glass-card">
              <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
                <LuImage className="h-8 w-8 text-muted-foreground/60" />
                <div>
                  <p className="font-medium">{t("worksEmpty")}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t("worksEmptyDesc")}</p>
                </div>
                <Link href="/start"><Button size="sm" className="mt-2">{t("goStart")}</Button></Link>
              </CardContent>
            </Card>
          ) : (
            <>
              <p className="mb-3 text-xs text-muted-foreground">{t("worksCount", { n: works.length })}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {works.map((w) => {
                  const rel = formatRelativeTime(w.createdAt, locale);
                  return (
                    <Card key={w.id} className="glass-card card-hover group overflow-hidden">
                      <CardContent className="p-0">
                        <Link href={`/project/${w.projectId}/export`} className="block">
                          <div className="relative aspect-[3/4] bg-muted/30">
                            {w.thumbnailUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element -- local file server, next/image adds nothing
                              <img src={w.thumbnailUrl} alt="" width={480} height={640} loading="lazy" className="h-full w-full object-cover" />
                            ) : (
                              <div className="absolute inset-0 flex items-center justify-center">
                                <LuPlay className="h-7 w-7 text-muted-foreground/50" />
                              </div>
                            )}
                            {w.label && (
                              <span className="absolute left-1.5 top-1.5 max-w-[85%] truncate rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                                {w.label}
                              </span>
                            )}
                          </div>
                        </Link>
                        <div className="flex items-center justify-between gap-1 p-2.5">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium">{w.productName || w.projectName || t("untitled")}</p>
                            <p className="truncate text-[11px] text-muted-foreground">{rel}</p>
                          </div>
                          <a
                            href={`${w.url}?download=1`}
                            title={t("download")}
                            aria-label={t("download")}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                          >
                            <LuDownload className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </>
          )
        ) : rows.length === 0 ? (
          <Card className="glass-card">
            <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
              <LuFolderOpen className="h-8 w-8 text-muted-foreground/60" />
              <div>
                <p className="font-medium">{t("empty")}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t("emptyDesc")}</p>
              </div>
              <div className="mt-2 flex gap-2">
                <Link href="/start"><Button size="sm">{t("goStart")}</Button></Link>
                <Link href="/project/new"><Button size="sm" variant="outline">{t("goNew")}</Button></Link>
              </div>
            </CardContent>
          </Card>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t("noMatch")}</p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p) => {
              const rel = formatRelativeTime(p.updatedAt, locale);
              const poster = posterByProject.get(p.id) ?? p.thumbnailUrl ?? (p.productImages?.[0] || null);
              const SourceIcon = sourceIcon(p);
              const effectiveStatus = effectiveStatusFor(p);
              return (
                <Card key={p.id} className="group h-full overflow-hidden border-border/65 bg-card/92 shadow-[0_10px_30px_rgba(38,68,101,.08)] transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-1 hover:border-primary/25 hover:shadow-[0_18px_42px_rgba(38,68,101,.14)]">
                  <CardContent className="p-0">
                    <Link href={projectContinuePath(p.id, effectiveStatus, p.productionMode, p.workflowType)} className="block">
                      {/* poster: latest render's first frame, falling back to the product photo */}
                      <div className="relative aspect-[16/10] overflow-hidden bg-muted/30">
                        {poster ? (
                          // eslint-disable-next-line @next/next/no-img-element -- local file server, next/image adds nothing
                          <img src={poster} alt="" width={640} height={400} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.035]" />
                        ) : (
                          <div className="absolute inset-0 grid place-items-center bg-[linear-gradient(145deg,color-mix(in_srgb,var(--primary)_7%,var(--card)),var(--muted))]">
                            <span className="grid size-12 place-items-center rounded-2xl border border-border/65 bg-card/70 shadow-sm"><LuImage className="h-5 w-5 text-muted-foreground/50" /></span>
                          </div>
                        )}
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/48 to-transparent" />
                        <Badge
                          variant={effectiveStatus === "done" ? "default" : "secondary"}
                          className="absolute left-3 top-3 border border-white/30 bg-card/90 text-[10px] text-foreground shadow-sm backdrop-blur-md"
                        >
                          <span className={`mr-1.5 size-1.5 rounded-full ${effectiveStatus === "done" ? "bg-[var(--success)]" : "bg-primary"}`} aria-hidden="true" />
                          {tc(statusKeyFor(effectiveStatus))}
                        </Badge>
                        <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-black/55 px-2 py-1 text-[10px] font-medium text-white backdrop-blur-md"><SourceIcon className="size-3" />{sourceLabel(p)}</span>
                        <span className="absolute bottom-3 right-3 grid size-8 translate-y-1 place-items-center rounded-full bg-white text-slate-900 opacity-0 shadow-lg transition-[opacity,transform] group-hover:translate-y-0 group-hover:opacity-100" aria-hidden="true"><LuArrowUpRight className="size-4" /></span>
                      </div>
                      <div className="px-4 pb-3 pt-4">
                        <p className="min-w-0 truncate text-[15px] font-semibold tracking-[-.015em] text-foreground">
                          {p.name || p.productName || t("untitled")}
                        </p>
                        {p.productName && p.productName !== p.name ? <p className="mt-1 truncate text-xs text-muted-foreground">{p.productName}</p> : null}
                      </div>
                    </Link>
                    <div className="flex items-center border-t border-border/55 px-4 py-2.5">
                      <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-[11px] text-muted-foreground"><LuClock3 className="size-3.5 shrink-0" />{rel || t("updatedNow")}</span>
                      <button
                        type="button"
                        onClick={() => handleDelete(p)}
                        title={t("moveToTrash")}
                        aria-label={t("moveToTrash")}
                        className="ml-auto flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground/65 opacity-100 transition-[background-color,color,opacity] hover:bg-destructive/10 hover:text-destructive md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                      >
                        <LuTrash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </PageFrame>
  );
}
