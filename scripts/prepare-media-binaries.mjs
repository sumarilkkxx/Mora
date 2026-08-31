import { execFile } from "node:child_process";
import { chmod } from "node:fs/promises";
import { createRequire } from "node:module";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

const ffmpegPath = require("ffmpeg-static");
const ffprobePath = require("@ffprobe-installer/ffprobe").path;

const binaries = [
  ["ffmpeg", ffmpegPath],
  ["ffprobe", ffprobePath],
];

for (const [name, binaryPath] of binaries) {
  if (typeof binaryPath !== "string" || binaryPath.length === 0) {
    throw new Error(`${name} binary path could not be resolved for ${process.platform}/${process.arch}`);
  }

  // npm/pnpm can materialize platform packages without the executable bit that was present in
  // the tarball. Windows does not use POSIX mode bits; macOS/Linux must repair them before tests
  // and before electron-builder copies the binaries into app.asar.unpacked.
  if (process.platform !== "win32") await chmod(binaryPath, 0o755);

  const { stdout, stderr } = await execFileAsync(binaryPath, ["-version"], {
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const firstLine = `${stdout || stderr}`.split(/\r?\n/, 1)[0];
  console.log(`[media-binaries] ${name} ready: ${binaryPath}`);
  console.log(`[media-binaries] ${firstLine}`);
}
