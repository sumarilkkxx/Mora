const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const {
  commitDesktopUpgrade,
  prepareDesktopUpgrade,
  recoverInterruptedDesktopUpgrade,
  rollbackDesktopUpgrade,
  verifyDesktopBackup,
} = require("./upgrade-guard.cjs");

function fixture() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mora-upgrade-"));
  const dataDir = path.join(userDataDir, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  return { userDataDir, dataDir, clean: () => fs.rmSync(userDataDir, { recursive: true, force: true }) };
}

function seedLegacyDatabase(dataDir) {
  const databasePath = path.join(dataDir, "sqlite.db");
  const sqlite = new Database(databasePath);
  sqlite.exec("create table legacy_projects (id text primary key, name text not null)");
  sqlite.prepare("insert into legacy_projects values (?, ?)").run("legacy-1", "升级前项目");
  sqlite.close();
  return databasePath;
}

test("fresh desktop install records the successful version without creating a backup", () => {
  const root = fixture();
  try {
    const plan = prepareDesktopUpgrade({ userDataDir: root.userDataDir, currentVersion: "0.3.0.0", now: () => new Date("2026-09-26T02:00:00.000Z") });
    assert.equal(plan.kind, "fresh-install");
    assert.equal(plan.backupDir, null);
    commitDesktopUpgrade(plan);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root.userDataDir, "desktop-version.json"), "utf8")), {
      version: "0.3.0.0",
      committedAt: "2026-09-26T02:00:00.000Z",
    });
    assert.equal(fs.existsSync(path.join(root.userDataDir, "upgrade-pending.json")), false);
  } finally { root.clean(); }
});

test("legacy database is copied to a checksum-verified backup before migration", () => {
  const root = fixture();
  try {
    const databasePath = seedLegacyDatabase(root.dataDir);
    const before = fs.readFileSync(databasePath);
    const plan = prepareDesktopUpgrade({ userDataDir: root.userDataDir, currentVersion: "0.3.0.0", now: () => new Date("2026-09-26T02:01:02.000Z") });
    assert.equal(plan.kind, "upgrade");
    assert.equal(plan.fromVersion, "legacy");
    assert.equal(verifyDesktopBackup(plan.backupDir).ok, true);
    const manifest = JSON.parse(fs.readFileSync(path.join(plan.backupDir, "manifest.json"), "utf8"));
    assert.deepEqual(manifest.files, [{
      name: "sqlite.db",
      bytes: before.byteLength,
      sha256: createHash("sha256").update(before).digest("hex"),
    }]);
    assert.equal(fs.existsSync(path.join(root.userDataDir, "upgrade-pending.json")), true);
  } finally { root.clean(); }
});

test("failed migration restores an old-schema fixture and writes recovery instructions", () => {
  const root = fixture();
  try {
    const databasePath = seedLegacyDatabase(root.dataDir);
    const plan = prepareDesktopUpgrade({ userDataDir: root.userDataDir, currentVersion: "0.3.0.0", now: () => new Date("2026-09-26T02:02:00.000Z") });
    fs.writeFileSync(databasePath, "broken migration output");
    fs.writeFileSync(`${databasePath}-wal`, "partial wal");
    const recovery = rollbackDesktopUpgrade(plan, new Error("fixture migration failed"));
    const sqlite = new Database(databasePath, { readonly: true });
    try {
      assert.deepEqual(sqlite.prepare("select * from legacy_projects").all(), [{ id: "legacy-1", name: "升级前项目" }]);
    } finally { sqlite.close(); }
    assert.equal(fs.existsSync(`${databasePath}-wal`), false);
    assert.match(fs.readFileSync(recovery.instructionsPath, "utf8"), /fixture migration failed/);
    assert.match(fs.readFileSync(recovery.instructionsPath, "utf8"), /0\.3\.0\.0/);
    assert.equal(fs.existsSync(plan.backupDir), true);
    assert.equal(fs.existsSync(path.join(root.userDataDir, "upgrade-pending.json")), false);
  } finally { root.clean(); }
});

test("interrupted migration is rolled back on the next launch before another upgrade attempt", () => {
  const root = fixture();
  try {
    const databasePath = seedLegacyDatabase(root.dataDir);
    prepareDesktopUpgrade({ userDataDir: root.userDataDir, currentVersion: "0.3.0.0", now: () => new Date("2026-09-26T02:03:00.000Z") });
    fs.writeFileSync(databasePath, "crash residue");
    const recovered = recoverInterruptedDesktopUpgrade({ userDataDir: root.userDataDir });
    assert.equal(recovered.recovered, true);
    const sqlite = new Database(databasePath, { readonly: true });
    try {
      const row = /** @type {{ name: string }} */ (sqlite.prepare("select name from legacy_projects").get());
      assert.equal(row.name, "升级前项目");
    }
    finally { sqlite.close(); }
  } finally { root.clean(); }
});

test("a successful version is not backed up again on ordinary restarts", () => {
  const root = fixture();
  try {
    seedLegacyDatabase(root.dataDir);
    const first = prepareDesktopUpgrade({ userDataDir: root.userDataDir, currentVersion: "0.3.0.0", now: () => new Date("2026-09-26T02:04:00.000Z") });
    commitDesktopUpgrade(first);
    const restart = prepareDesktopUpgrade({ userDataDir: root.userDataDir, currentVersion: "0.3.0.0", now: () => new Date("2026-09-26T02:05:00.000Z") });
    assert.equal(restart.kind, "same-version");
    assert.equal(restart.backupDir, null);
    assert.equal(fs.readdirSync(path.join(root.userDataDir, "backups", "desktop-upgrades")).length, 1);
  } finally { root.clean(); }
});

test("rejects a tampered previous version before constructing a backup path", () => {
  const root = fixture();
  try {
    seedLegacyDatabase(root.dataDir);
    fs.writeFileSync(path.join(root.userDataDir, "desktop-version.json"), JSON.stringify({ version: "../../outside" }));
    assert.throws(
      () => prepareDesktopUpgrade({ userDataDir: root.userDataDir, currentVersion: "0.3.0.0" }),
      /Invalid desktop version/,
    );
    assert.equal(fs.existsSync(path.join(root.userDataDir, "backups")), false);
  } finally { root.clean(); }
});
