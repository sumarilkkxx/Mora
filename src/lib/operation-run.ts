import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";

export type OperationKind = "batch" | "pipeline" | "compose" | "auto_edit";
export type OperationStatus = "queued" | "running" | "waiting_input" | "cancel_requested" | "done" | "failed" | "cancelled" | "interrupted";
export type OperationRun = typeof schema.operationRuns.$inferSelect;
type Database = BetterSQLite3Database<typeof schema>;
const processState = globalThis as typeof globalThis & { moraOperationOwner?: string };
export const operationOwner = processState.moraOperationOwner ??= `${process.pid}:${randomUUID()}`;

export interface OperationRunOptions {
  now?: () => number;
  owner: string;
  leaseMs?: number;
}

/**
 * Generic execution lifecycle. It deliberately knows nothing about scripts,
 * products, compositions or provider payloads; adapters store those in domain tables.
 */
export class OperationRunRepository {
  private readonly now: () => number;
  private readonly owner: string;
  private readonly leaseMs: number;

  constructor(private readonly database: Database, options: OperationRunOptions) {
    this.now = options.now ?? Date.now;
    this.owner = options.owner;
    this.leaseMs = options.leaseMs ?? 60_000;
  }

  create(input: { id?: string; kind: OperationKind; subjectId: string; requestKey: string; stage: string; checkpoint?: Record<string, unknown> }): { run: OperationRun; created: boolean } {
    const now = new Date(this.now());
    const id = input.id ?? randomUUID();
    const inserted = this.database.insert(schema.operationRuns).values({
      id, kind: input.kind, subjectId: input.subjectId, requestKey: input.requestKey,
      stage: input.stage, checkpoint: input.checkpoint, createdAt: now, updatedAt: now,
    }).onConflictDoNothing().returning().get();
    const run = inserted ?? this.database.select().from(schema.operationRuns).where(eq(schema.operationRuns.requestKey, input.requestKey)).get();
    if (!run) throw new Error("Operation run could not be created or recovered");
    return { run, created: Boolean(inserted) };
  }

  read(id: string): OperationRun | undefined {
    return this.database.select().from(schema.operationRuns).where(eq(schema.operationRuns.id, id)).get();
  }

  claim(id: string): OperationRun | undefined {
    const now = this.now();
    return this.database.update(schema.operationRuns).set({
      status: "running", owner: this.owner, leaseUntil: now + this.leaseMs,
      attempt: sql`${schema.operationRuns.attempt} + 1`, updatedAt: new Date(now), error: null,
    }).where(and(
      eq(schema.operationRuns.id, id),
      inArray(schema.operationRuns.status, ["queued", "running", "interrupted"]),
      or(isNull(schema.operationRuns.owner), lte(schema.operationRuns.leaseUntil, now)),
    )).returning().get();
  }

  heartbeat(id: string): boolean {
    const now = this.now();
    return this.database.update(schema.operationRuns).set({ leaseUntil: now + this.leaseMs, updatedAt: new Date(now) })
      .where(and(eq(schema.operationRuns.id, id), eq(schema.operationRuns.owner, this.owner), eq(schema.operationRuns.status, "running"), gt(schema.operationRuns.leaseUntil, now))).run().changes > 0;
  }

  release(id: string): boolean {
    const now = this.now();
    return this.database.update(schema.operationRuns).set({ status: "interrupted", owner: null, leaseUntil: null, error: "interrupted", updatedAt: new Date(now) })
      .where(and(eq(schema.operationRuns.id, id), eq(schema.operationRuns.owner, this.owner), eq(schema.operationRuns.status, "running"))).run().changes > 0;
  }

  checkpoint(id: string, checkpoint: Record<string, unknown>, stage: string): boolean {
    const now = this.now();
    return this.database.update(schema.operationRuns).set({ checkpoint, stage, leaseUntil: now + this.leaseMs, updatedAt: new Date(now) })
      .where(and(eq(schema.operationRuns.id, id), eq(schema.operationRuns.owner, this.owner), inArray(schema.operationRuns.status, ["running", "cancel_requested"]), gt(schema.operationRuns.leaseUntil, now))).run().changes > 0;
  }

  requestCancel(id: string): OperationStatus | undefined {
    const run = this.read(id);
    if (!run) return undefined;
    if (run.status === "queued" || run.status === "interrupted") {
      this.database.update(schema.operationRuns).set({ status: "cancelled", updatedAt: new Date(this.now()) }).where(and(eq(schema.operationRuns.id, id), inArray(schema.operationRuns.status, ["queued", "interrupted"]))).run();
    } else if (run.status === "running") {
      this.database.update(schema.operationRuns).set({ status: "cancel_requested", updatedAt: new Date(this.now()) }).where(and(eq(schema.operationRuns.id, id), eq(schema.operationRuns.status, "running"))).run();
    }
    return this.read(id)?.status;
  }

  cancellationRequested(id: string): boolean {
    return this.read(id)?.status === "cancel_requested";
  }

  finish(id: string, status: "done" | "failed" | "cancelled" | "waiting_input", result?: Record<string, unknown>, error?: string): boolean {
    const now = this.now();
    return this.database.update(schema.operationRuns).set({
      status, result, error: error?.slice(0, 1000), owner: null, leaseUntil: null, updatedAt: new Date(now),
    }).where(and(
      eq(schema.operationRuns.id, id), eq(schema.operationRuns.owner, this.owner),
      inArray(schema.operationRuns.status, ["running", "cancel_requested"]), gt(schema.operationRuns.leaseUntil, now),
    )).run().changes > 0;
  }

  recoverExpired(now = this.now()): number {
    const cancelled = this.database.update(schema.operationRuns).set({ status: "cancelled", owner: null, leaseUntil: null, updatedAt: new Date(now) })
      .where(and(eq(schema.operationRuns.status, "cancel_requested"), or(isNull(schema.operationRuns.leaseUntil), lte(schema.operationRuns.leaseUntil, now)))).run().changes;
    const interrupted = this.database.update(schema.operationRuns).set({ status: "interrupted", owner: null, leaseUntil: null, error: "interrupted", updatedAt: new Date(now) })
      .where(and(eq(schema.operationRuns.status, "running"), or(isNull(schema.operationRuns.leaseUntil), lte(schema.operationRuns.leaseUntil, now)))).run().changes;
    return cancelled + interrupted;
  }

  interruptIfOrphaned(id: string): boolean {
    const now = this.now();
    return this.database.update(schema.operationRuns).set({ status: "interrupted", owner: null, leaseUntil: null, error: "interrupted", updatedAt: new Date(now) })
      .where(and(eq(schema.operationRuns.id, id), eq(schema.operationRuns.status, "running"), or(isNull(schema.operationRuns.owner), ne(schema.operationRuns.owner, this.owner), isNull(schema.operationRuns.leaseUntil), lte(schema.operationRuns.leaseUntil, now)))).run().changes > 0;
  }
}
