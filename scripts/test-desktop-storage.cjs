// Run with Electron, using a disposable profile. Seed simulates the previous
// random-port release; verify tests migration and subsequent application restarts.
// MORA_STORAGE_TEST_DIR=<temp dir> MORA_STORAGE_TEST_PHASE=seed|verify electron <this file>
const { app, BrowserWindow, session } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const { getStableServerPort } = require("../electron/server-port.cjs");

const directory = process.env.MORA_STORAGE_TEST_DIR;
const phase = process.env.MORA_STORAGE_TEST_PHASE;
if (!directory || !["seed", "verify"].includes(phase)) throw new Error("Disposable storage test directory and seed/verify phase required");
app.setPath("userData", directory);
app.disableHardwareAcceleration();
let window;
let server;
const deadline = setTimeout(() => app.exit(1), 30_000);
app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  await session.defaultSession.setProxy({ mode: "direct" });
  const port = phase === "seed" ? 0 : await getStableServerPort(directory);
  server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<!doctype html><title>Storage regression fixture</title>");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(undefined));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Desktop storage fixture did not expose a TCP port");
  const origin = `http://127.0.0.1:${address.port}`;
  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL(origin);
  if (phase === "seed") {
    await window.webContents.executeJavaScript('localStorage.setItem("mora-storage-regression", "preserved");');
    fs.mkdirSync(path.join(directory, "logs"), { recursive: true });
    fs.writeFileSync(path.join(directory, "logs", "server.log"), `[main] fork 本地服务 pid=123 port=${address.port} entry=fixture\n`);
    fs.writeFileSync(path.join(directory, "expected-origin.txt"), origin);
  } else {
    assert.equal(origin, fs.readFileSync(path.join(directory, "expected-origin.txt"), "utf8"));
    assert.equal(await window.webContents.executeJavaScript('localStorage.getItem("mora-storage-regression")'), "preserved");
  }
  session.defaultSession.flushStorageData();
  fs.writeFileSync(path.join(directory, `${phase}-result.json`), JSON.stringify({ phase, origin, success: true }));
  window.destroy();
  await new Promise((resolve) => server.close(resolve));
  clearTimeout(deadline);
  app.quit();
}).catch((error) => {
  fs.writeFileSync(path.join(directory, `${phase}-error.txt`), String(error.stack || error));
  app.exit(1);
});
