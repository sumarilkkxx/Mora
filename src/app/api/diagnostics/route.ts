import { NextRequest, NextResponse } from "next/server";
import { DiagnosticBundleService, type DiagnosticDraft } from "@/lib/diagnostic-bundle";
import { createLocalDiagnosticSources } from "@/lib/diagnostic-sources";

export const runtime = "nodejs";

const DRAFT_TTL_MS = 15 * 60_000;
const drafts = new Map<string, { draft: DiagnosticDraft; expiresAt: number }>();

function service(): DiagnosticBundleService {
  return new DiagnosticBundleService({ sources: createLocalDiagnosticSources() });
}

function pruneDrafts(now = Date.now()): void {
  for (const [id, entry] of drafts) if (entry.expiresAt <= now) drafts.delete(id);
}

function draftNotFound(): NextResponse {
  return NextResponse.json({ error: "Diagnostic preview expired or was cancelled", code: "DRAFT_NOT_FOUND" }, { status: 404 });
}

function aborted(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function GET(request: NextRequest) {
  try {
    pruneDrafts();
    const draft = await service().generate({ signal: request.signal });
    drafts.set(draft.id, { draft, expiresAt: Date.now() + DRAFT_TTL_MS });
    return NextResponse.json(draft, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    if (aborted(error)) return NextResponse.json({ error: "Diagnostic generation cancelled", code: "GENERATION_CANCELLED" }, { status: 499 });
    console.error("Diagnostic generation failed:", error);
    return NextResponse.json({ error: "Diagnostic generation failed", code: "GENERATION_FAILED" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    pruneDrafts();
    const body = await request.json().catch(() => ({})) as { draftId?: unknown };
    if (typeof body.draftId !== "string") return NextResponse.json({ error: "A reviewed diagnostic draft is required", code: "DRAFT_REQUIRED" }, { status: 400 });
    const entry = drafts.get(body.draftId);
    if (!entry) return draftNotFound();
    const archive = await service().export(entry.draft, { signal: request.signal });
    drafts.delete(body.draftId);
    const stamp = entry.draft.generatedAt.replace(/[:.]/g, "-");
    return new NextResponse(new Uint8Array(archive), {
      headers: {
        "Content-Type": "application/vnd.mora.diagnostics+zip",
        "Content-Length": String(archive.byteLength),
        "Content-Disposition": `attachment; filename="mora-diagnostics-${stamp}.zip"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    if (aborted(error)) return NextResponse.json({ error: "Diagnostic export cancelled", code: "EXPORT_CANCELLED" }, { status: 499 });
    console.error("Diagnostic export failed:", error);
    return NextResponse.json({ error: "Diagnostic export failed", code: "EXPORT_FAILED" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const draftId = request.nextUrl.searchParams.get("draftId");
  if (draftId) drafts.delete(draftId);
  return new NextResponse(null, { status: 204 });
}
