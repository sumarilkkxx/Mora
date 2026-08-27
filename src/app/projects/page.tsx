"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { LuPlus, LuFolderOpen, LuTrash2, LuDownload, LuImage, LuPlay } from "react-icons/lu";
import { useT, useLocale } from "@/lib/i18n";
import { formatRelativeTime } from "@/lib/relative-time";
import { PageFrame, PageHeader, SegmentedControl, SegmentedItem, Skeleton } from "@/components/studio/page";

interface ProjectRow {
  id: string;
  name: string;
  productName: string | null;
  productImages?: string[] | null;
  status: string;
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

// project status → the pipeline step to resume at (done lands on export where the film lives)
function stepFor(status: string): string {
  if (status === "done") return "export";
  if (status === "composing" || status === "video") return "video";
  if (status === "assets") return "assets";
  return "script";
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
  const [works, setWorks] = useState<WorkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"projects" | "works">("projects");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [projRes, workRes] = await Promise.all([
          fetch("/api/project"),
          fetch("/api/works").catch(() => null),
        ]);
        if (!projRes.ok) throw new Error(String(projRes.status));
        const data = await projRes.json();
        const list: ProjectRow[] = Array.isArray(data) ? data : [];
        const ts = (p: ProjectRow) => {
          if (!p.updatedAt) return 0;
          const time = new Date(p.updatedAt).getTime();
          return Number.isFinite(time) ? time : 0;
        };
        if (!cancelled) setRows([...list].sort((a, b) => ts(b) - ts(a)));
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((p) =>
      (p.name || "").toLowerCase().includes(q) || (p.productName || "").toLowerCase().includes(q)
    );
  }, [rows, query]);

  // delete = destructive: text-level confirm first; the row disappears only after the API succeeds
  const handleDelete = async (p: ProjectRow) => {
    if (!window.confirm(t("deleteConfirm", { name: p.name || p.productName || t("untitled") }))) return;
    try {
      const res = await fetch(`/api/project/${p.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      setRows((prev) => prev.filter((r) => r.id !== p.id));
      setWorks((prev) => prev.filter((w) => w.projectId !== p.id));
    } catch {
      window.alert(t("deleteFailed"));
    }
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

        {/* projects / works view switch */}
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <SegmentedControl>
            {(["projects", "works"] as const).map((v) => (
              <SegmentedItem
                key={v}
                onClick={() => setView(v)}
                selected={view === v}
              >
                {t(v === "projects" ? "tabProjects" : "tabWorks")}
                {v === "works" && works.length > 0 && <span className="ml-1 opacity-70">({works.length})</span>}
              </SegmentedItem>
            ))}
          </SegmentedControl>
          {view === "projects" && rows.length > 0 && (
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="max-w-sm text-sm"
            />
          )}
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p) => {
              const rel = formatRelativeTime(p.updatedAt, locale);
              const poster = posterByProject.get(p.id) ?? (p.productImages?.[0] || null);
              return (
                <Card key={p.id} className="glass-card card-hover group h-full overflow-hidden">
                  <CardContent className="p-0">
                    <Link href={`/project/${p.id}/${stepFor(p.status)}`} className="block">
                      {/* poster: latest render's first frame, falling back to the product photo */}
                      <div className="relative aspect-video bg-muted/30">
                        {poster ? (
                          // eslint-disable-next-line @next/next/no-img-element -- local file server, next/image adds nothing
                          <img src={poster} alt="" width={640} height={360} loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <LuImage className="h-7 w-7 text-muted-foreground/40" />
                          </div>
                        )}
                        <Badge
                          variant={p.status === "done" ? "default" : "secondary"}
                          className="absolute left-2 top-2 text-[11px]"
                        >
                          {tc(statusKeyFor(p.status))}
                        </Badge>
                      </div>
                      <div className="p-4 pb-3">
                        <p className="min-w-0 truncate text-sm font-medium">
                          {p.name || p.productName || t("untitled")}
                        </p>
                        <p className="mt-1.5 truncate text-xs text-muted-foreground">
                          {p.productName || ""}
                          {p.productName && rel ? " · " : ""}
                          {rel || ""}
                        </p>
                      </div>
                    </Link>
                    <div className="flex justify-end px-2 pb-2">
                      <button
                        type="button"
                        onClick={() => handleDelete(p)}
                        title={t("deleteProject")}
                        aria-label={t("deleteProject")}
                        className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground/70 opacity-100 transition-colors hover:bg-red-500/15 hover:text-red-400 md:opacity-0 md:group-hover:opacity-100"
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
