const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prunePayload, verifyPayload } = require('./desktop-payload.cjs');

test('keeps the full target ASR runtime and media tools while removing caches and foreign binaries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mora-payload-'));
  const put = (name, text = 'fixture') => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  };
  try {
    for (const target of ['darwin/arm64', 'win32/x64', 'win32/arm64', 'linux/x64']) {
      put(`node_modules/onnxruntime-node/bin/napi-v6/${target}/onnxruntime_binding.node`);
      put(`node_modules/onnxruntime-node/bin/napi-v6/${target}/runtime-library`);
    }
    put('.pnpm-store/cache');
    put('assets/readme/image.png');
    put('public/examples/demo.mp4');
    put('node_modules/ffmpeg-static/ffmpeg');
    prunePayload(root, 'win32', 'x64');
    assert.equal(fs.existsSync(path.join(root, '.pnpm-store')), false);
    assert.equal(fs.existsSync(path.join(root, 'assets/readme')), false);
    for (const file of ['node_modules/onnxruntime-node/bin/napi-v6/win32/x64/runtime-library', 'public/examples/demo.mp4', 'node_modules/ffmpeg-static/ffmpeg']) {
      assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), 'fixture');
    }
    assert.throws(() => verifyPayload(root, 'darwin', 'arm64'));
    put('.pnpm-store/cache');
    assert.throws(() => verifyPayload(root, 'win32', 'x64'), /Unexpected desktop payload/);
    // An unsupported target must fail before deleting anything.
    assert.throws(() => prunePayload(root, 'darwin', 'arm64'), /Missing bundled ASR/);
    assert.equal(fs.existsSync(path.join(root, '.pnpm-store/cache')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
