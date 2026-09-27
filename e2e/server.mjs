import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

// Each run gets a fresh DB/uploads/cache and a disposable HOME. Never reuse the
// user's running app, local data, credentials or provider environment.
const root = mkdtempSync(join(tmpdir(), 'mora-e2e-'));
const dataDir = join(root, 'data');
const homeDir = join(root, 'home');
const processTmpDir = join(root, 'tmp');
mkdirSync(dataDir, { recursive: true });
mkdirSync(homeDir, { recursive: true });
mkdirSync(processTmpDir, { recursive: true });
mkdirSync('test-results', { recursive: true });
const logFile = join(process.cwd(), 'test-results', 'e2e-server.log');
const stateFile = join(process.cwd(), 'test-results', 'e2e-server-state.json');
writeFileSync(logFile, '');
console.log(`Isolated E2E data: ${dataDir}`);

const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '3107'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    PATH: process.env.PATH,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    CI: process.env.CI,
    FFMPEG_PATH: process.env.FFMPEG_PATH,
    FFPROBE_PATH: process.env.FFPROBE_PATH,
    HOME: homeDir,
    TMPDIR: processTmpDir,
    NODE_ENV: 'development',
    NEXT_TELEMETRY_DISABLED: '1',
    WATCHPACK_POLLING: 'true',
    APP_DATA_DIR: dataDir,
  },
});
writeFileSync(stateFile, JSON.stringify({ root, wrapperPid: process.pid, serverPid: child.pid }));

for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
  stream.on('data', chunk => {
    appendFileSync(logFile, chunk);
    output.write(chunk);
  });
}

let stopping = false;
function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  child.kill(signal);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(signal));

child.on('exit', code => {
  rmSync(root, { recursive: true, force: true });
  process.exit(stopping ? 0 : (code ?? 1));
});
