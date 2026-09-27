import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { LocalStateRepository, type LocalStateScope, type LocalStateSnapshot } from "@/lib/local-state-repository";

const repository = new LocalStateRepository(db);
const scopes = new Set<LocalStateScope>(["products", "templates", "characters", "brand", "settings"]);

export async function GET() {
  try { return NextResponse.json(repository.read()); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const snapshot = await request.json() as LocalStateSnapshot;
    return NextResponse.json(repository.migrateBrowserState(snapshot));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { scope?: LocalStateScope; value?: unknown };
    if (!body.scope || !scopes.has(body.scope)) return NextResponse.json({ error: "Invalid local-state scope" }, { status: 400 });
    repository.replace(body.scope, body.value);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
