// Run with Electron's Node runtime from the installed package during smoke tests.
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

async function checkRuntime(entry) {
  const requireFromServer = createRequire(entry);
  const ort = requireFromServer('onnxruntime-node');
  new ort.Tensor('float32', new Float32Array([1]), [1]);
  // Exercise the native binding initialization as well as the JS wrapper.
  const binding = requireFromServer('onnxruntime-node/dist/binding.js');
  binding.initOrt();
  const transformers = await import(pathToFileURL(requireFromServer.resolve('@huggingface/transformers')).href);
  if (typeof transformers.pipeline !== 'function') throw new Error('ASR pipeline unavailable');
  for (const binary of [requireFromServer('ffmpeg-static'), requireFromServer('@ffprobe-installer/ffprobe').path]) {
    execFileSync(binary, ['-version'], { timeout: 30000, stdio: 'pipe' });
  }
}

if (require.main === module) checkRuntime(process.argv[2]).then(() => console.log('RUNTIME_OK')).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { checkRuntime };
