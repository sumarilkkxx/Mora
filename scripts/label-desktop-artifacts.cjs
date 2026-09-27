const fs = require("node:fs");
const path = require("node:path");

function labelDesktopArtifacts(releaseDir, suffix) {
  if (!suffix || !/^[a-z0-9-]+$/i.test(suffix)) throw new Error("A safe artifact suffix is required");
  const installers = fs.readdirSync(releaseDir)
    .filter(name => /\.(?:dmg|exe)$/i.test(name))
    .sort();
  const labeled = installers.map(name => {
    if (name.endsWith(`-${suffix}${path.extname(name)}`)) return path.join(releaseDir, name);
    const extension = path.extname(name);
    const target = path.join(releaseDir, `${path.basename(name, extension)}-${suffix}${extension}`);
    fs.renameSync(path.join(releaseDir, name), target);
    return target;
  });
  if (!labeled.length) throw new Error(`No desktop installers found in ${releaseDir}`);
  return labeled;
}

if (require.main === module) {
  const releaseDir = process.argv[2] ?? "release";
  const suffix = process.argv[3];
  for (const artifact of labelDesktopArtifacts(releaseDir, suffix)) console.log(artifact);
}

module.exports = { labelDesktopArtifacts };
