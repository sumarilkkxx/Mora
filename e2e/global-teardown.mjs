import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function readServerState() {
  const stateFile = join(process.cwd(), 'test-results', 'e2e-server-state.json');
  if (!existsSync(stateFile)) throw new Error(`E2E server state was not created: ${stateFile}`);
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const root = realpathSync(state.root);
  if (dirname(root) !== realpathSync(tmpdir()) || !basename(root).startsWith('mora-e2e-')) {
    throw new Error(`Refusing to manage unexpected E2E directory: ${root}`);
  }
  return { ...state, root, stateFile };
}

async function stopServerAndVerifyCleanup() {
  const { root, stateFile, wrapperPid } = readServerState();
  try {
    process.kill(wrapperPid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  let alive = true;
  for (let attempt = 0; attempt < 100 && alive; attempt += 1) {
    await wait(50);
    try {
      process.kill(wrapperPid, 0);
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
      alive = false;
    }
  }
  if (alive) throw new Error(`E2E server wrapper did not stop: ${wrapperPid}`);

  // Next may flush its disabled-telemetry preference immediately after shutdown.
  // Wait for the process tree to settle, then perform one final validated cleanup.
  await wait(250);
  rmSync(root, { recursive: true, force: true });
  if (existsSync(root)) throw new Error(`E2E server did not remove its isolated data directory: ${root}`);
  rmSync(stateFile, { force: true });
}

export default async function verifyServerLog() {
  const logFile = join(process.cwd(), 'test-results', 'e2e-server.log');
  if (!existsSync(logFile)) throw new Error(`E2E server log was not created: ${logFile}`);

  const log = readFileSync(logFile, 'utf8');
  const fatalPatterns = [
    /uncaughtException/i,
    /unhandledRejection/i,
    /Controller is already closed/i,
    /ERR_INVALID_STATE/,
  ];
  const match = fatalPatterns.find(pattern => pattern.test(log));
  const unexpectedNextError = log
    .split(/(?=^⨯ Error:)/m)
    .filter(block => block.startsWith("⨯ Error:"))
    .find(block => !/^⨯ Error: aborted\b/.test(block) || !/code: 'ECONNRESET'/.test(block));
  await stopServerAndVerifyCleanup();
  if (match || unexpectedNextError) {
    throw new Error(`E2E server reported an unhandled runtime failure (${match ?? "unexpected Next.js error"}):\n${log}`);
  }
}
