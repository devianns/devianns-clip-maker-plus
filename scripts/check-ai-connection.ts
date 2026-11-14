// Explicit opt-in smoke request. No user audio, keys, or transcript are printed.
import { existsSync } from 'node:fs';
import { createAiHandler } from '../modules/ai-api/server/handler.ts';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const provider = process.argv.includes('--openai')
  ? 'openai'
  : (process.env.AI_PROVIDER ?? (process.env.CHATGPT_API_KEY ? 'openai' : 'deepseek'));
const configured =
  provider === 'openai' ? !!process.env.CHATGPT_API_KEY : !!process.env.DEEPSEEK_API_KEY;
if (!configured) {
  console.log(
    JSON.stringify({
      configured: false,
      provider,
      error: 'Selected provider API key is not configured',
    }),
  );
  process.exitCode = 1;
} else {
  const bytes = new ArrayBuffer(44 + 16000 * 2),
    view = new DataView(bytes);
  const tag = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
  };
  tag(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, 32000, true);
  const form = new FormData();
  form.set('file', new File([bytes], 'silence.wav', { type: 'audio/wav' }));
  form.set('requestId', 'connection-check');
  const handler = createAiHandler({
    key: process.env.DEEPSEEK_API_KEY,
    openaiKey: process.env.CHATGPT_API_KEY,
    openaiModel: process.env.OPENAI_TRANSCRIBE_MODEL,
    provider,
    development: true,
    allowedOrigins: [],
  });
  const response = await handler(
    new Request('http://localhost/api/ai/transcribe', { method: 'POST', body: form }),
  );
  const result = await response.json();
  console.log(
    JSON.stringify({
      configured: true,
      provider,
      status: response.status,
      ok: response.ok,
      ...(response.ok
        ? { validTranscript: typeof result.text === 'string' }
        : { error: result.error }),
    }),
  );
  if (!response.ok) process.exitCode = 1;
}
