import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';

// Only the external model/TTS boundary is replaced. Unknown requests fail closed.
export async function startProvider(audioFile: string, sceneEnd = 5) {
  const calls: string[] = [];
  let fault: 'none' | 'invalid-json' | '429' = 'none';
  const server = createServer(async (req, res) => {
    try {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      if (req.url === '/v1/audio/speech') {
        calls.push('tts');
        res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
        return res.end(readFileSync(audioFile));
      }
      if (req.url !== '/v1/chat/completions') { res.writeHead(404); return res.end(); }
      const content = JSON.stringify(body.messages);
      let result: unknown;
      if (content.includes('Analyze timestamped sampled video frames')) {
        calls.push('analysis');
        if (fault === '429') { res.writeHead(429); return res.end(JSON.stringify({ error: { message: 'Fixture rate limit' } })); }
        result = { summary: '固定响应：工程占位分析；不用于模型质量评分', style: '近景', scenes: [{ start: 0, end: sceneEnd, text: '画面内容占位', uncertainty: '固定工程响应' }] };
      } else if (content.includes('three candidate advertisements') || content.includes('exactly three distinct')) {
        calls.push('copy');
        result = { recommendedId: 'effect', candidates: ['effect', 'scenario', 'explore'].map(strategy => ({
          version: 1, id: strategy, strategy, title: '视频片段', angle: strategy,
          hook: '看看视频片段。', body: '呈现画面细节。', cta: '了解更多。',
          voiceover: '看看视频片段。\n呈现画面细节。\n了解更多。', evidence: ['固定响应的画面依据占位'],
        })) };
      } else if (content.includes('Review representative output frames')) {
        calls.push('review'); result = { issues: [], summary: '固定工程复核；不代表质量评分' };
      } else { res.writeHead(400); return res.end(JSON.stringify({ error: { message: 'Unexpected fixture request' } })); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'fixture', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: fault === 'invalid-json' ? 'not-json' : JSON.stringify(result) }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }));
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  return { calls, setFault: (value: typeof fault) => { fault = value; },
    credentials: { llm: { baseUrl, apiKey: 'fixture-only', model: 'fixture-text', visionModel: 'fixture-vision' }, tts: { baseUrl, apiKey: 'fixture-only', model: 'fixture-tts', voice: 'fixture' } },
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
