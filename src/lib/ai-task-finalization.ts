// A page can mount more than one responsive TaskCenter instance. Both may observe
// the same completed cloud task at once, so coalesce finalization in this server
// process. The persisted ai_tasks status remains the cross-restart idempotency check.
const finalizationLocks = new Map<string, Promise<unknown>>();

export async function withAiTaskFinalizationLock<T>(
  provider: string,
  taskId: string,
  finalize: () => Promise<T>
): Promise<T> {
  const key = `${provider}:${taskId}`;
  const existing = finalizationLocks.get(key);
  if (existing) return existing as Promise<T>;

  const pending = finalize();
  finalizationLocks.set(key, pending);
  try {
    return await pending;
  } finally {
    if (finalizationLocks.get(key) === pending) finalizationLocks.delete(key);
  }
}
