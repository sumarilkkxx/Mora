// Requires npm run build. Runs only against a disposable SQLite database.
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { createServer } = require("node:net");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { checkServer } = require("../electron/smoke-check.cjs");

async function main() {
  const directory = await mkdtemp(join(tmpdir(), "mora-api-server-"));
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", () => resolve(undefined)));
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("Local API fixture did not expose a TCP port");
  const port = address.port;
  await new Promise((resolve) => probe.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, NODE_ENV: "production", PORT: String(port), HOSTNAME: "127.0.0.1", APP_DATA_DIR: directory, APP_MIGRATIONS_DIR: join(process.cwd(), "drizzle"), MORA_API_TOKEN: "fixture-token", MORA_SERVER_ORIGIN: origin };
  /** @type {import("node:child_process").ChildProcessWithoutNullStreams | null} */
  let child = null;
  let logs = "";
  const stop = async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGKILL"); await exited;
    }
  };
  const start = async () => {
    child = spawn(process.execPath, [join(process.cwd(), ".next/standalone/server.js")], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (data) => { logs = (logs + data).slice(-5000); });
    child.stderr.on("data", (data) => { logs = (logs + data).slice(-5000); });
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(logs);
      try { const response = await fetch(origin + "/api/health", { headers: { "x-mora-token": "fixture-token" }, signal: AbortSignal.timeout(1000) }); if (response.status === 200) return; } catch { /* starting */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Server startup timed out: " + logs);
  };
  try {
    await start();
    await checkServer(origin, "fixture-token");
    assert.equal((await fetch(origin + "/api/project")).status, 401);
    assert.equal((await fetch(origin + "/api/project", { method: "POST", headers: { origin: "https://evil.example", "content-type": "text/plain" }, body: "{}" })).status, 403);
    assert.equal((await fetch(origin + "/api/project", { method: "POST", headers: { origin, "x-mora-token": "fixture-token", "content-type": "text/plain" }, body: "{}" })).status, 415);
    const created = await fetch(origin + "/api/project", { method: "POST", headers: { origin, "x-mora-token": "fixture-token", "content-type": "application/json" }, body: JSON.stringify({ name: "Recovery fixture" }) });
    assert.equal(created.status, 201);
    const project = /** @type {{ id: string }} */ (await created.json());
    await promisify(execFile)(process.execPath, ["bin/mora.mjs", "list"], { env: { ...env, MORA_BASE_URL: origin }, windowsHide: true });
    if (!child?.pid) throw new Error("Local API fixture process has no PID");
    const sqlite = new Database(join(directory, "sqlite.db"));
    sqlite.prepare("INSERT INTO compositions (id, project_id, status, created_at, render_owner, render_heartbeat) VALUES ('interrupted', ?, 'composing', unixepoch(), ?, unixepoch())").run(project.id, `${child.pid}:fixture`);
    sqlite.close();
    await stop();
    await start();
    const response = await fetch(`${origin}/api/project/${project.id}/compose?compositionId=interrupted`, { headers: { "x-mora-token": "fixture-token" } });
    const result = /** @type {{ composition: { status: string } }} */ (await response.json());
    assert.equal(result.composition.status, "failed");
    console.log("LOCAL_API_OK: auth, CLI, database smoke and immediate restart recovery");
  } finally { await stop(); await rm(directory, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
