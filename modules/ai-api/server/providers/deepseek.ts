import { AiError, transcript } from '../../shared/contracts.ts';
import type { Provider } from '../provider.ts';
export function deepseek(
  key: string,
  fetcher: typeof fetch = fetch,
): Provider & { transcribe: NonNullable<Provider['transcribe']> } {
  return {
    id: 'deepseek',
    operations: ['transcribe'],
    audioLimits: { maxAudioBytes: 8 * 1024 * 1024, maxAudioSeconds: 120 },
    async transcribe(file, requestId, signal) {
      const body = new FormData();
      body.set('file', file, 'speech.wav');
      const response = await fetcher('https://api.deepseek.com/v1/tools/asr', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body,
        signal,
      });
      if (!response.ok) {
        const code = response.status;
        await response.body?.cancel();
        if (code === 401 || code === 403)
          throw new AiError('AUTH', 'AI 공급자 인증 또는 사용 권한을 확인하세요.', 502);
        if (code === 402)
          throw new AiError(
            'BILLING',
            'DeepSeek 계정의 잔액이 부족합니다. 잔액을 확인한 뒤 다시 시도하세요.',
            402,
          );
        if (code === 429)
          throw new AiError(
            'RATE_LIMIT',
            'AI 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.',
            429,
          );
        if (code === 408 || code === 504)
          throw new AiError('TIMEOUT', 'AI 음성인식 시간이 초과됐습니다.', 504);
        throw new AiError('PROVIDER', `음성인식 요청을 완료하지 못했습니다. (HTTP ${code})`, 502);
      }
      // Bound even successful upstream responses before parsing.
      const reader = response.body?.getReader();
      if (!reader) throw new AiError('RESPONSE', 'AI 응답이 비어 있습니다.', 502);
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          length += part.value.length;
          if (length > 128_000) throw new AiError('RESPONSE', 'AI 응답이 너무 큽니다.', 502);
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      try {
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        const result = JSON.parse(new TextDecoder().decode(bytes));
        return transcript({ requestId, text: result.text, durationMs: result.duration_ms });
      } catch (error) {
        if (error instanceof AiError) throw error;
        throw new AiError('RESPONSE', 'AI 응답을 해석하지 못했습니다.', 502);
      }
    },
  };
}
