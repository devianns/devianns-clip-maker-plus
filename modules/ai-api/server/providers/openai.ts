import { AiError, transcript } from '../../shared/contracts.ts';
import type { Provider } from '../provider.ts';

export function openai(
  key: string,
  model = 'gpt-transcribe',
  fetcher: typeof fetch = fetch,
): Provider & { transcribe: NonNullable<Provider['transcribe']> } {
  return {
    id: 'openai',
    operations: ['transcribe'],
    audioLimits: { maxAudioBytes: 25_000_000, maxAudioSeconds: 120 },
    async transcribe(file, requestId, signal) {
      const body = new FormData();
      body.set('file', file, 'speech.wav');
      body.set('model', model);
      body.set('response_format', 'json');
      const response = await fetcher('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body,
        signal,
      });
      // Bound response size, including error bodies; never expose raw provider messages.
      const reader = response.body?.getReader();
      if (!reader) throw new AiError('RESPONSE', 'OpenAI 응답이 비어 있습니다.', 502);
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 128_000) throw new AiError('RESPONSE', 'OpenAI 응답이 너무 큽니다.', 502);
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      let result: { text?: unknown; error?: { code?: unknown } };
      try {
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const part of chunks) {
          bytes.set(part, offset);
          offset += part.length;
        }
        result = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new AiError(
          'RESPONSE',
          `OpenAI 응답 형식을 확인하세요. (HTTP ${response.status})`,
          502,
        );
      }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403)
          throw new AiError('AUTH', 'OpenAI API 키와 프로젝트 권한을 확인하세요.', 502);
        if (response.status === 402 || result?.error?.code === 'insufficient_quota')
          throw new AiError(
            'BILLING',
            'OpenAI API 잔액 또는 프로젝트 사용 한도를 확인하세요. ChatGPT 구독과 API 결제는 별개입니다.',
            402,
          );
        if (response.status === 429)
          throw new AiError(
            'RATE_LIMIT',
            'OpenAI 요청 한도에 도달했습니다. 잠시 후 다시 시도하세요.',
            429,
          );
        if (response.status === 404)
          throw new AiError(
            'CONFIGURATION',
            'OpenAI 전사 모델 이름 또는 모델 사용 권한을 확인하세요.',
            502,
          );
        throw new AiError('PROVIDER', `OpenAI 음성인식 요청 실패 (HTTP ${response.status})`, 502);
      }
      // The common server accepts canonical PCM16 mono WAV; duration comes from audio, not invented alignment.
      const header = new DataView(await file.slice(0, 44).arrayBuffer());
      if (header.byteLength !== 44 || header.getUint32(28, true) === 0)
        throw new AiError('INPUT', 'WAV 음성 길이를 읽을 수 없습니다.');
      const durationMs = Math.round(((file.size - 44) / header.getUint32(28, true)) * 1000);
      return transcript({ requestId, text: result?.text, durationMs });
    },
  };
}
