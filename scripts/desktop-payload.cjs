const fs = require('node:fs');
const path = require('node:path');

// Only build-time/repository content; models and runtime dependencies stay bundled.
const excluded = ['.pnpm-store', '.git', '.github', '.next-dev', 'data', 'docs', 'tasks', 'release', 'integrations', 'e2e', 'evals', '.scratch', 'test-results', 'playwright-report', 'remotion', 'assets/readme', 'tsconfig.tsbuildinfo', 'pnpm-lock.yaml'];

function runtimeRoot(root) {
  return path.join(root, 'node_modules/onnxruntime-node/bin/napi-v6');
}

function prunePayload(root, platform = process.platform, arch = process.arch) {
  const binaries = runtimeRoot(root);
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(binaries));
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('Refusing to prune ASR binaries outside the staged payload');
  }
  const binding = path.join(binaries, platform, arch, 'onnxruntime_binding.node');
  if (!fs.existsSync(binding)) throw new Error(`Missing bundled ASR binding: ${binding}`);
  for (const name of excluded) fs.rmSync(path.join(root, name), { recursive: true, force: true });
  for (const os of fs.readdirSync(binaries)) {
    if (os !== platform) fs.rmSync(path.join(binaries, os), { recursive: true, force: true });
    else for (const cpu of fs.readdirSync(path.join(binaries, os))) {
      if (cpu !== arch) fs.rmSync(path.join(binaries, os, cpu), { recursive: true, force: true });
    }
  }
  verifyPayload(root, platform, arch);
}

function verifyPayload(root, platform = process.platform, arch = process.arch) {
  for (const name of excluded) {
    if (fs.existsSync(path.join(root, name))) throw new Error(`Unexpected desktop payload: ${name}`);
  }
  const binaries = runtimeRoot(root);
  if (fs.readdirSync(binaries).join() !== platform || fs.readdirSync(path.join(binaries, platform)).join() !== arch) {
    throw new Error(`ASR payload must contain only ${platform}/${arch}`);
  }
  if (!fs.existsSync(path.join(binaries, platform, arch, 'onnxruntime_binding.node'))) throw new Error('Missing ASR binding');
}

function size(root) {
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink()) return 0; // links inside standalone are not extra copies
  return stat.isDirectory() ? fs.readdirSync(root).reduce((sum, name) => sum + size(path.join(root, name)), 0) : stat.size;
}

function reportPayload(root) {
  const rows = fs.readdirSync(root).map(name => ({ name, bytes: size(path.join(root, name)) })).sort((a, b) => b.bytes - a.bytes);
  for (const row of rows.slice(0, 8)) console.log(`[payload] ${row.name}: ${(row.bytes / 1024 ** 2).toFixed(1)} MiB`);
  console.log(`[payload] Total: ${(rows.reduce((sum, row) => sum + row.bytes, 0) / 1024 ** 2).toFixed(1)} MiB (uncompressed)`);
}

module.exports = { excluded, prunePayload, verifyPayload, reportPayload };
