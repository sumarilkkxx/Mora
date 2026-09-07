const http = require("node:http");

function readJson(url, token, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: { "x-mora-token": token } }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > 1024 * 1024) req.destroy(new Error("Smoke response too large"));
        else chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("end", () => {
        clearTimeout(timer);
        if (res.statusCode !== 200) return reject(new Error(`Smoke HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new Error("Smoke response is not JSON")); }
      });
    });
    const timer = setTimeout(() => req.destroy(new Error("Smoke request timed out")), timeoutMs);
    req.on("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

async function checkServer(url, token, timeoutMs) {
  const health = await readJson(`${url}/api/health`, token, timeoutMs);
  if (health?.db?.status !== "ok" || health.db.initError || health.db.migrationError) {
    throw new Error("Smoke database initialization/migration check failed");
  }
  const projects = await readJson(`${url}/api/project`, token, timeoutMs);
  if (!Array.isArray(projects)) throw new Error("Smoke project response is not an array");
}

module.exports = { checkServer };
