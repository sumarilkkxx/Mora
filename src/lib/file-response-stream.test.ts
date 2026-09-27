import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileResponseStream } from "./file-response-stream";

const roots: string[] = [];

async function fixture(contents: string) {
  const root = await mkdtemp(join(tmpdir(), "mora file stream 媒体-"));
  roots.push(root);
  const path = join(root, "fixture.bin");
  await writeFile(path, contents);
  return path;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe("createFileResponseStream", () => {
  it("streams the whole file", async () => {
    const stream = await createFileResponseStream(await fixture("0123456789"), { chunkSize: 3 });
    expect(await new Response(stream).text()).toBe("0123456789");
  });

  it("uses an inclusive byte range", async () => {
    const stream = await createFileResponseStream(await fixture("0123456789"), { start: 2, end: 5, chunkSize: 2 });
    expect(await new Response(stream).text()).toBe("2345");
  });

  it("allows media clients to cancel after the first chunk", async () => {
    const stream = await createFileResponseStream(await fixture("0123456789"), { chunkSize: 2 });
    const reader = stream.getReader();
    expect(Buffer.from((await reader.read()).value!).toString()).toBe("01");
    await expect(reader.cancel("range replaced")).resolves.toBeUndefined();
  });

  it("supports concurrent range readers when one client cancels", async () => {
    const path = await fixture("0123456789abcdefghijklmnopqrstuvwxyz");
    const streams = await Promise.all([
      createFileResponseStream(path, { start: 0, end: 9, chunkSize: 2 }),
      createFileResponseStream(path, { start: 10, end: 19, chunkSize: 3 }),
      createFileResponseStream(path, { start: 20, end: 29, chunkSize: 4 }),
    ]);
    const cancelled = streams[1].getReader();
    expect(Buffer.from((await cancelled.read()).value!).toString()).toBe("abc");
    await expect(cancelled.cancel("seek replaced")).resolves.toBeUndefined();
    await expect(new Response(streams[0]).text()).resolves.toBe("0123456789");
    await expect(new Response(streams[2]).text()).resolves.toBe("klmnopqrst");
  });

  it("closes the file when its owning request is aborted", async () => {
    const controller = new AbortController();
    let closed = 0;
    const stream = await createFileResponseStream(await fixture("0123456789"), {
      chunkSize: 2,
      signal: controller.signal,
      onClose: () => { closed += 1; },
    });
    const reader = stream.getReader();
    await reader.read();
    controller.abort();
    await expect.poll(() => closed).toBe(1);
  });

  it("closes on the last known byte without requiring another pull", async () => {
    let closed = 0;
    const stream = await createFileResponseStream(await fixture("0123456789"), {
      end: 9,
      chunkSize: 10,
      onClose: () => { closed += 1; },
    });
    const result = await stream.getReader().read();
    expect(Buffer.from(result.value!).toString()).toBe("0123456789");
    await expect.poll(() => closed).toBe(1);
  });

  it("can be reopened repeatedly after full reads and cancellation", async () => {
    const path = await fixture("0123456789");
    for (let index = 0; index < 25; index += 1) {
      const stream = await createFileResponseStream(path, { start: index % 5, chunkSize: 1 });
      if (index % 2 === 0) {
        const reader = stream.getReader();
        await reader.read();
        await expect(reader.cancel("browser seek")).resolves.toBeUndefined();
      } else {
        await expect(new Response(stream).text()).resolves.toBe("0123456789".slice(index % 5));
      }
    }
  });
});
