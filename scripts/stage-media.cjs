const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

// Next's dynamic require tracing can omit platform executables (notably ffprobe.exe).
// Materialize the installed host packages explicitly before the staged tree is copied.
function stageMedia(root, standalone, platform = process.platform, arch = process.arch) {
  const sourceRequire = createRequire(path.join(root, 'package.json'));
  for (const name of ['ffmpeg-static', '@ffprobe-installer/ffprobe', `@ffprobe-installer/${platform}-${arch}`]) {
    const source = path.dirname(sourceRequire.resolve(`${name}/package.json`));
    const target = path.join(standalone, 'node_modules', name);
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true, dereference: true });
  }
  const stagedRequire = createRequire(path.join(standalone, 'server.js'));
  const paths = [stagedRequire('ffmpeg-static'), stagedRequire('@ffprobe-installer/ffprobe').path];
  for (const binary of paths) {
    if (!binary || !fs.existsSync(binary)) throw new Error(`Missing staged media binary: ${binary}`);
    const relative = path.relative(fs.realpathSync(standalone), fs.realpathSync(binary));
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Media binary escapes payload: ${binary}`);
    if (platform !== 'win32') fs.chmodSync(binary, 0o755);
  }
}

module.exports = { stageMedia };
