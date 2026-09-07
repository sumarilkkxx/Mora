// electron scripts/test-desktop-api.cjs — isolated profile, local fixtures only.
const { app, BrowserWindow, session } = require("electron");
const { createServer } = require("node:http");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const assert = require("node:assert/strict");
const { installApiCredentials } = require("../electron/api-session.cjs");
app.setPath("userData", mkdtempSync(join(tmpdir(), "mora-api-ui-")));
app.disableHardwareAcceleration();
const deadline = setTimeout(() => app.exit(1), 30000);
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  await session.defaultSession.setProxy({ mode: "direct" });
  const server = createServer((req, res) => {
    if (req.url.startsWith("/api/") || req.url === "/external") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ token: req.headers["x-mora-token"] ?? null }));
    } else { res.setHeader("content-type", "text/html"); res.end("<!doctype html><title>API fixture</title>"); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  installApiCredentials(window, origin, "fixture");
  await window.loadURL(origin);
  assert.deepEqual(await window.webContents.executeJavaScript('fetch("/api/project").then(r => r.json())'), { token: "fixture" });
  assert.deepEqual(await window.webContents.executeJavaScript('fetch("/external").then(r => r.json())'), { token: null });
  const other = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await other.loadURL(origin);
  assert.deepEqual(await other.webContents.executeJavaScript('fetch("/api/project").then(r => r.json())'), { token: null });
  console.log("DESKTOP_API_OK");
  other.destroy(); window.destroy(); server.close(); clearTimeout(deadline); app.exit(0);
}).catch((error) => { console.error(error); app.exit(1); });
