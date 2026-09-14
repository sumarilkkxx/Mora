// Electron main process: start Next standalone as a local HTTP server, then load it in a window.
// Key points (all validated through real packaging tests):
//  - Data is written to app.getPath('userData')/data (writable), injected into the server via APP_DATA_DIR (standalone cwd is read-only)
//  - ffmpeg/ffprobe use bundled binaries, injected via FFMPEG_PATH/FFPROBE_PATH (no ffmpeg install required on the user's machine)
//  - Persist the local port to preserve browser storage across launches; kill the server on exit
const { app, BrowserWindow, dialog, shell } = require("electron");
const { fork } = require("child_process");
const http = require("http");
const { createRequire } = require("node:module");
const { getStableServerPort } = require("./server-port.cjs");
const path = require("path");
const fs = require("fs");
const { randomBytes } = require("node:crypto");
const { checkServer } = require("./smoke-check.cjs");
const { installApiCredentials } = require("./api-session.cjs");
const apiToken = randomBytes(32).toString("hex");

let serverChild = null;
let mainWindow = null;
let childExited = false; // set once the server child errors/exits, so waitReady can fail fast instead of polling a dead port
let childExitInfo = "";
let logFilePath = "";
let serverUrl = "";

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

/** Prepare the diagnostics log file (truncated once per launch). Startup failures on a packaged GUI app are otherwise invisible — there is no console — so everything funnels here. */
function initLog() {
  try {
    const logDir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(logDir, { recursive: true });
    logFilePath = path.join(logDir, "server.log");
    fs.writeFileSync(logFilePath, `=== Mora 启动 ${new Date().toISOString()} (${process.platform}/${process.arch}) ===\n`);
  } catch {
    logFilePath = "";
  }
}

/** Append a line from the main process to the diagnostics log (best-effort). */
function log(line) {
  if (!logFilePath) return;
  try {
    fs.appendFileSync(logFilePath, `[main] ${line}\n`);
  } catch {
    /* ignore */
  }
}

/** Read the tail of the diagnostics log to embed in the failure dialog. */
function readLogTail(maxChars = 3000) {
  if (!logFilePath) return "";
  try {
    return fs.readFileSync(logFilePath, "utf8").slice(-maxChars);
  } catch {
    return "";
  }
}

/** Resolve the absolute path of a bundled binary, correcting asar → asar.unpacked */
function resolveBinary(getter) {
  try {
    let p = getter();
    if (p && p.includes("app.asar" + path.sep)) {
      p = p.replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep);
    }
    return p || "";
  } catch {
    return "";
  }
}

/** Path to standalone server.js entry: resources/standalone when packaged, .next/standalone in dev */
function serverEntry() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "standalone", "server.js")
    : path.join(__dirname, "..", ".next", "standalone", "server.js");
}

/** SQL migrations directory (read-only resource): bundled alongside standalone when packaged, or project root drizzle in dev */
function migrationsDir(serverDir) {
  return app.isPackaged ? path.join(serverDir, "drizzle") : path.join(__dirname, "..", "drizzle");
}

/**
 * Poll via HTTP until the server is available (typically ready in ~0.5s).
 * Timeout raised to ~30s (tries=120 × 250ms): a Windows first launch cold-starts the Next server behind
 * Defender real-time scanning of a freshly-installed unsigned exe, which can far exceed the old 15s budget.
 * If the child process dies first (childExited), reject immediately instead of polling a dead port for the full window.
 */
function waitReady(port, tries = 120) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      if (childExited) return reject(new Error("本地服务进程已退出：" + childExitInfo));
      const req = http.get({ host: "127.0.0.1", port, path: "/" }, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) return resolve();
        retry(n);
      });
      req.on("error", () => retry(n));
      req.setTimeout(2000, () => req.destroy(new Error("Readiness timeout")));
    };
    const retry = (n) => (n <= 0 ? reject(new Error("本地服务未就绪（超时）")) : setTimeout(() => attempt(n - 1), 250));
    attempt(tries);
  });
}

/** Start the standalone server child process, wait until ready, and return the access URL */
async function startServer(port) {
  const entry = serverEntry();
  const serverDir = path.dirname(entry);
  const dataDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(app.getPath("userData"), "api-token"), apiToken, { mode: 0o600 });

  // Share the server's bundled media tools; do not ship a second copy in app.asar.
  const mediaRequire = app.isPackaged ? createRequire(entry) : require;
  const ffmpegPath = resolveBinary(() => mediaRequire("ffmpeg-static"));
  const ffprobePath = resolveBinary(() => mediaRequire("@ffprobe-installer/ffprobe").path);

  // Route the child's stdout/stderr to the diagnostics log via a real file descriptor rather than "inherit".
  // Critical on Windows: a packaged GUI (windowed) exe has no console, so the inherited stdout/stderr handles are
  // invalid — Next's server.js writes its startup banner to stdout, the resulting EBADF/EPIPE surfaces as an
  // unhandled 'error' on the child's stdout stream and crashes the server before it ever binds the port, which the
  // user experiences as "clicked, nothing happened". A file descriptor is always a valid write target.
  let outFd = "ignore";
  if (logFilePath) {
    try {
      outFd = fs.openSync(logFilePath, "a");
    } catch {
      outFd = "ignore";
    }
  }

  serverChild = fork(entry, [], {
    cwd: serverDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      MORA_API_TOKEN: apiToken,
      MORA_SERVER_ORIGIN: `http://127.0.0.1:${port}`,
      APP_DATA_DIR: dataDir,
      APP_MIGRATIONS_DIR: migrationsDir(serverDir),
      ...(ffmpegPath ? { FFMPEG_PATH: ffmpegPath } : {}),
      ...(ffprobePath ? { FFPROBE_PATH: ffprobePath } : {}),
    },
    stdio: ["ignore", outFd, outFd, "ipc"],
  });

  // Fail fast: if the child cannot spawn or dies during startup, waitReady stops polling immediately.
  serverChild.on("error", (err) => {
    childExited = true;
    childExitInfo = "spawn error: " + err.message;
    log(childExitInfo);
  });
  serverChild.on("exit", (code, signal) => {
    childExited = true;
    childExitInfo = `子进程退出 code=${code} signal=${signal}`;
    log(childExitInfo);
  });

  log(`fork 本地服务 pid=${serverChild.pid} port=${port} entry=${entry}`);
  await waitReady(port);
  return `http://127.0.0.1:${port}`;
}

function killServer() {
  if (serverChild) {
    try {
      serverChild.kill();
    } catch {
      /* ignore */
    }
    serverChild = null;
  }
}

function openExternalHttp(target) {
  try {
    const parsed = new URL(target);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") void shell.openExternal(parsed.href);
  } catch {
    log(`拒绝打开非法外部链接: ${target}`);
  }
}

function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "Mora",
    backgroundColor: "#0a0a0a",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  installApiCredentials(mainWindow, url, apiToken);
  // Keep arbitrary web pages outside the privileged application window. Product/provider links
  // open in the user's default browser, while same-origin Next navigations stay inside Mora.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (new URL(target).origin === new URL(url).origin) void mainWindow?.loadURL(target);
    else openExternalHttp(target);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (new URL(target).origin === new URL(url).origin) return;
    event.preventDefault();
    openExternalHttp(target);
  });
  // Surface a failed page load (e.g. the server died right after readiness) rather than leaving a blank window.
  mainWindow.webContents.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return; // ERR_ABORTED: benign (e.g. redirect/navigation), ignore
    log(`页面加载失败 code=${errorCode} desc=${errorDescription} url=${validatedURL}`);
    dialog.showErrorBox(
      "Mora 页面加载失败 / Page load failed",
      `${errorDescription} (${errorCode})\n${validatedURL}\n\n日志 / Log: ${logFilePath || "(不可用)"}`
    );
  });
  mainWindow.loadURL(url);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  let url;
  try {
    // Read the previous launch log before initLog truncates it (legacy migration).
    const port = await getStableServerPort(app.getPath("userData"));
    initLog();
    url = await startServer(port);
    serverUrl = url;
  } catch (e) {
    const msg = (e && (e.stack || e.message)) || String(e);
    log("启动本地服务失败: " + msg);
    // Surface the failure instead of quitting silently: a packaged GUI app has no console, so without this the
    // window simply never appears and the user reports "clicked, nothing happened" with no way to diagnose.
    if (!process.env.HEADLESS_SMOKE) {
      dialog.showErrorBox(
        "Mora 启动失败 / Failed to start",
        `本地服务未能启动 / The local service failed to start.\n\n${(e && e.message) || e}\n\n` +
          `日志 / Log: ${logFilePath || "(不可用)"}\n\n--- 日志末尾 / log tail ---\n${readLogTail()}`
      );
    } else {
      console.error("启动本地服务失败:", msg);
    }
    killServer();
    app.exit(1);
    return;
  }

  // Headless smoke mode: verify the server can start under the Electron runtime and hit a DB route
  // (triggers better-sqlite3 load + migrate under the Electron Node ABI); no window is opened, exits immediately
  if (process.env.HEADLESS_SMOKE) {
    try {
      await require("./runtime-check.cjs").checkRuntime(serverEntry());
      await checkServer(url, apiToken);
      console.log("SMOKE_OK", url, "DATA_DIR=" + path.join(app.getPath("userData"), "data"));
      killServer();
      app.exit(0);
    } catch (error) {
      console.error("SMOKE_FAILED", error.message);
      killServer();
      app.exit(1);
    }
    return;
  }

  createMainWindow(url);
});

app.on("activate", () => {
  // macOS convention: closing the last window keeps the application alive; clicking the Dock
  // icon must recreate the window. The local server remains alive until the app actually quits.
  if (BrowserWindow.getAllWindows().length === 0 && serverUrl) createMainWindow(serverUrl);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    killServer();
    app.quit();
  }
});

app.on("before-quit", killServer);
