// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { createServer, type Server } from "net";
import { getStableServerPort } from "../../../electron/server-port.cjs";

const directories: string[] = [];
const servers: Server[] = [];
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "mora-port-test-"));
  directories.push(root);
  return root;
}
async function listen() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  return { server, port: address.port };
}
async function close(server: Server) {
  if (server.listening) await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map(close));
  await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("desktop origin persistence", () => {
  it("persists the first origin and reuses it after subsequent launches", async () => {
    const root = await directory();
    const first = await getStableServerPort(root);
    expect(first).toBeGreaterThanOrEqual(1024);
    expect(await getStableServerPort(root)).toBe(first);
    expect(JSON.parse(await readFile(join(root, "server-port.json"), "utf8"))).toEqual({ port: first });
  });

  it("recovers the previous legacy origin before the log can be truncated", async () => {
    const root = await directory();
    const { server, port } = await listen();
    await close(server);
    await mkdir(join(root, "logs"));
    await writeFile(join(root, "logs", "server.log"), `[main] fork 本地服务 pid=123 port=${port} entry=server.js\n`);
    expect(await getStableServerPort(root)).toBe(port);
    await writeFile(join(root, "logs", "server.log"), "new launch without a port");
    expect(await getStableServerPort(root)).toBe(port);
  });

  it("refuses a port conflict without changing the stored origin", async () => {
    const root = await directory();
    const { port } = await listen();
    await writeFile(join(root, "server-port.json"), JSON.stringify({ port }));
    await expect(getStableServerPort(root)).rejects.toThrow("不会自动切换端口");
    expect(JSON.parse(await readFile(join(root, "server-port.json"), "utf8"))).toEqual({ port });
  });

  it("retains a conflicting legacy port for the next attempt", async () => {
    const root = await directory();
    const { server, port } = await listen();
    await mkdir(join(root, "logs"));
    await writeFile(join(root, "logs", "server.log"), `[main] fork 本地服务 pid=123 port=${port} entry=server.js`);
    await expect(getStableServerPort(root)).rejects.toThrow("不会自动切换端口");
    await close(server);
    expect(await getStableServerPort(root)).toBe(port);
  });

  it("fails visibly on corrupt saved configuration instead of resetting storage", async () => {
    const root = await directory();
    await writeFile(join(root, "server-port.json"), '{"port":0}');
    await expect(getStableServerPort(root)).rejects.toThrow("不会切换端口");
  });
});
