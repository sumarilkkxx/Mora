const fs = require("fs");
const path = require("path");
const net = require("net");

function validPort(port) {
  return Number.isInteger(port) && port >= 1024 && port <= 65535;
}

function probePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const selected = server.address().port;
      server.close((error) => error ? reject(error) : resolve(selected));
    });
  });
}

// The renderer's localStorage belongs to its HTTP origin, including its port.
// Recover the last legacy origin before the startup log is truncated, then keep
// that origin stable. Never silently change ports when an existing one is busy.
async function getStableServerPort(userData) {
  const configPath = path.join(userData, "server-port.json");
  let port;
  try {
    port = JSON.parse(fs.readFileSync(configPath, "utf8")).port;
    if (!validPort(port)) throw new Error("Invalid saved port");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error(`无法读取已保存的本地端口，请检查 ${configPath}。为保护原有设置，本次不会切换端口。`, { cause: error });
    }
    let legacyLog = "";
    try {
      legacyLog = fs.readFileSync(path.join(userData, "logs", "server.log"), "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const matches = [...legacyLog.matchAll(/fork 本地服务 pid=\d+ port=(\d+)\b/g)];
    const previous = Number(matches.at(-1)?.[1]);
    port = validPort(previous) ? previous : await probePort(0);
    fs.mkdirSync(userData, { recursive: true });
    // Persist before probing the legacy port: even a failed launch must retain
    // the old origin, rather than depending on the next launch's diagnostic log.
    const temporary = `${configPath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ port }), { mode: 0o600 });
    fs.renameSync(temporary, configPath);
  }
  try {
    await probePort(port);
  } catch (error) {
    throw new Error(`本地端口 ${port} 不可用，请关闭占用该端口的程序后重试。为保留已有设置和素材库，Mora 不会自动切换端口。`, { cause: error });
  }
  return port;
}

module.exports = { getStableServerPort };
