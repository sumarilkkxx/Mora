const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

const DATABASE_FILES = ["sqlite.db", "sqlite.db-wal", "sqlite.db-shm"];

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function sha256(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function safeVersion(value) {
  const version = String(value ?? "").trim();
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version)) throw new Error(`Invalid desktop version: ${version || "<empty>"}`);
  return version;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function pathsFor(userDataDir) {
  return {
    dataDir: path.join(userDataDir, "data"),
    statePath: path.join(userDataDir, "desktop-version.json"),
    pendingPath: path.join(userDataDir, "upgrade-pending.json"),
    backupRoot: path.join(userDataDir, "backups", "desktop-upgrades"),
    recoveryDir: path.join(userDataDir, "recovery"),
  };
}

function assertBackupPath(userDataDir, backupDir) {
  const root = path.resolve(pathsFor(userDataDir).backupRoot);
  const candidate = path.resolve(backupDir);
  if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Refusing desktop backup outside ${root}`);
  }
  return candidate;
}

function verifyDesktopBackup(backupDir) {
  try {
    const manifest = readJson(path.join(backupDir, "manifest.json"));
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || manifest.files.length === 0) {
      return { ok: false, error: "Invalid backup manifest" };
    }
    for (const entry of manifest.files) {
      if (!DATABASE_FILES.includes(entry.name)) return { ok: false, error: `Unexpected backup entry: ${entry.name}` };
      const filePath = path.join(backupDir, entry.name);
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size !== entry.bytes || sha256(filePath) !== entry.sha256) {
        return { ok: false, error: `Backup checksum mismatch: ${entry.name}` };
      }
    }
    return { ok: true, manifest };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function prepareDesktopUpgrade({ userDataDir, currentVersion, now = () => new Date() }) {
  const version = safeVersion(currentVersion);
  const locations = pathsFor(userDataDir);
  fs.mkdirSync(locations.dataDir, { recursive: true });
  let previous = null;
  if (fs.existsSync(locations.statePath)) {
    const storedVersion = readJson(locations.statePath).version;
    previous = storedVersion == null ? null : safeVersion(storedVersion);
  }
  const nowIso = now().toISOString();
  const databasePath = path.join(locations.dataDir, "sqlite.db");
  if (previous === version) {
    return { kind: "same-version", userDataDir, currentVersion: version, fromVersion: previous, backupDir: null, nowIso };
  }
  if (!fs.existsSync(databasePath)) {
    return { kind: "fresh-install", userDataDir, currentVersion: version, fromVersion: previous, backupDir: null, nowIso };
  }

  const fromVersion = previous || "legacy";
  const stamp = nowIso.replace(/[:.]/g, "-");
  let backupDir = path.join(locations.backupRoot, `${stamp}-${fromVersion}-to-${version}`);
  if (fs.existsSync(backupDir)) backupDir += `-${randomUUID()}`;
  fs.mkdirSync(backupDir, { recursive: true });
  const files = [];
  for (const name of DATABASE_FILES) {
    const source = path.join(locations.dataDir, name);
    if (!fs.existsSync(source)) continue;
    const destination = path.join(backupDir, name);
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    const stat = fs.statSync(destination);
    files.push({ name, bytes: stat.size, sha256: sha256(destination) });
  }
  atomicJson(path.join(backupDir, "manifest.json"), {
    schemaVersion: 1,
    createdAt: nowIso,
    fromVersion,
    toVersion: version,
    files,
  });
  const verification = verifyDesktopBackup(backupDir);
  if (!verification.ok) throw new Error(`Desktop backup verification failed: ${verification.error}`);
  const plan = { kind: "upgrade", userDataDir, currentVersion: version, fromVersion, backupDir, nowIso };
  atomicJson(locations.pendingPath, plan);
  return plan;
}

function commitDesktopUpgrade(plan) {
  if (!plan?.userDataDir) throw new Error("Desktop upgrade plan is required");
  if (plan.backupDir) {
    const verification = verifyDesktopBackup(assertBackupPath(plan.userDataDir, plan.backupDir));
    if (!verification.ok) throw new Error(`Refusing to commit without a valid backup: ${verification.error}`);
  }
  const locations = pathsFor(plan.userDataDir);
  atomicJson(locations.statePath, { version: safeVersion(plan.currentVersion), committedAt: plan.nowIso });
  fs.rmSync(locations.pendingPath, { force: true });
  return { statePath: locations.statePath, backupDir: plan.backupDir };
}

function rollbackDesktopUpgrade(plan, cause) {
  if (!plan?.backupDir) throw new Error("No desktop upgrade backup is available for rollback");
  const backupDir = assertBackupPath(plan.userDataDir, plan.backupDir);
  const verification = verifyDesktopBackup(backupDir);
  if (!verification.ok) throw new Error(`Refusing rollback from an invalid backup: ${verification.error}`);
  const locations = pathsFor(plan.userDataDir);
  fs.mkdirSync(locations.dataDir, { recursive: true });
  for (const name of DATABASE_FILES) fs.rmSync(path.join(locations.dataDir, name), { force: true });
  for (const entry of verification.manifest.files) {
    fs.copyFileSync(path.join(backupDir, entry.name), path.join(locations.dataDir, entry.name));
  }
  fs.rmSync(locations.pendingPath, { force: true });
  fs.mkdirSync(locations.recoveryDir, { recursive: true });
  const message = cause instanceof Error ? cause.message : String(cause ?? "unknown migration failure");
  const reportPath = path.join(locations.recoveryDir, "last-upgrade-failure.json");
  const instructionsPath = path.join(locations.recoveryDir, "last-upgrade-failure.txt");
  atomicJson(reportPath, {
    schemaVersion: 1,
    failedVersion: plan.currentVersion,
    restoredVersion: plan.fromVersion,
    backupDir,
    error: message.slice(0, 2000),
  });
  fs.writeFileSync(instructionsPath,
    `Mora upgrade to ${plan.currentVersion} failed.\n` +
    `The previous database (${plan.fromVersion}) was restored from a checksum-verified backup.\n` +
    `Backup: ${backupDir}\n` +
    `Reason: ${message.slice(0, 2000)}\n` +
    "Keep this backup and reinstall the previous Mora version before opening the project again.\n",
    { mode: 0o600 },
  );
  return { reportPath, instructionsPath, backupDir };
}

function recoverInterruptedDesktopUpgrade({ userDataDir }) {
  const pendingPath = pathsFor(userDataDir).pendingPath;
  if (!fs.existsSync(pendingPath)) return { recovered: false };
  const plan = readJson(pendingPath);
  const recovery = rollbackDesktopUpgrade(plan, new Error("Previous desktop upgrade was interrupted before migration validation completed"));
  return { recovered: true, ...recovery };
}

module.exports = {
  commitDesktopUpgrade,
  prepareDesktopUpgrade,
  recoverInterruptedDesktopUpgrade,
  rollbackDesktopUpgrade,
  verifyDesktopBackup,
};
