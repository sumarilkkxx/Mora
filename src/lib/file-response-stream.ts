import { open } from "node:fs/promises";

interface FileStreamOptions {
  start?: number;
  /** Inclusive final byte, matching HTTP Range semantics. */
  end?: number;
  chunkSize?: number;
  /** Closes the owned file handle when the HTTP request is disconnected. */
  signal?: AbortSignal;
  /** Runs once after the file handle closes, including response cancellation. */
  onClose?: () => void | Promise<void>;
}

/**
 * Streams a file without adapting a Node Readable into a Web ReadableStream.
 *
 * Next.js may cancel a response when a browser replaces a media Range request.
 * Node's Readable.toWeb adapter can race its `end` and `cancel` paths and attempt
 * to close an already-closed controller. Owning the FileHandle here makes that
 * cancellation explicit and idempotent.
 */
export async function createFileResponseStream(
  filePath: string,
  options: FileStreamOptions = {},
): Promise<ReadableStream<Uint8Array>> {
  const handle = await open(filePath, "r");
  const start = options.start ?? 0;
  const end = options.end ?? Number.POSITIVE_INFINITY;
  const chunkSize = options.chunkSize ?? 64 * 1024;
  let offset = start;
  let finished = false;
  let cancelled = false;
  let closing: Promise<void> | undefined;

  const abortListener = () => {
    cancelled = true;
    finished = true;
    void close().catch(() => undefined);
  };

  function close() {
    closing ??= handle.close()
      .then(async () => { await options.onClose?.(); })
      .finally(() => {
        options.signal?.removeEventListener("abort", abortListener);
      });
    return closing;
  }
  if (options.signal?.aborted) {
    await close();
    throw options.signal.reason ?? new DOMException("The request was aborted", "AbortError");
  }
  options.signal?.addEventListener("abort", abortListener, { once: true });

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished || cancelled) return;
      try {
        const remaining = end - offset + 1;
        if (remaining <= 0) {
          finished = true;
          await close();
          if (!cancelled) controller.close();
          return;
        }

        const buffer = Buffer.allocUnsafe(Math.min(chunkSize, remaining));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        if (cancelled) return;
        if (bytesRead === 0) {
          finished = true;
          await close();
          if (!cancelled) controller.close();
          return;
        }

        offset += bytesRead;
        controller.enqueue(buffer.subarray(0, bytesRead));
        if (offset > end) {
          finished = true;
          await close();
          if (!cancelled) controller.close();
        }
      } catch (error) {
        if (cancelled) return;
        finished = true;
        await close().catch(() => undefined);
        controller.error(error);
      }
    },
    async cancel() {
      cancelled = true;
      finished = true;
      await close();
    },
  });
}
