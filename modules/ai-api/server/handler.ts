import { AiError, LIMITS } from '../shared/contracts.ts';
import { deepseek } from './providers/deepseek.ts';
import type { Provider } from './provider.ts';
import {
  authenticated,
  readPassword,
  sessionCookie,
  validPasswordHash,
  verifyPassword,
} from './password.ts';
export type ServerConfig = {
  key?: string;
  provider?: string;
  passwordHash?: string;
  allowedOrigins: string[];
  development: boolean;
};
/** A shared limiter must be supplied in multi-instance deployments. */
export type Admission = (identity: string) => Promise<boolean>;
export function createAiHandler(
  config: ServerConfig,
  admission?: Admission,
  suppliedProvider?: Provider,
) {
  const providers = new Map<string, Provider>();
  if (config.key) providers.set('deepseek', deepseek(config.key));
  if (suppliedProvider) providers.set(suppliedProvider.id, suppliedProvider);
  const provider = providers.get(config.provider ?? 'deepseek');
  const maxAudioBytes = Math.min(
    LIMITS.maxAudioBytes,
    provider?.audioLimits?.maxAudioBytes ?? LIMITS.maxAudioBytes,
  );
  const maxAudioSeconds = Math.min(
    LIMITS.maxAudioSeconds,
    provider?.audioLimits?.maxAudioSeconds ?? LIMITS.maxAudioSeconds,
  );
  let active = 0;
  let loginActive = 0;
  const recent = new Map<string, number[]>();
  return async function handle(request: Request): Promise<Response> {
    const origin = request.headers.get('origin');
    const headers: Record<string, string> = {
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      'X-Content-Type-Options': 'nosniff',
    };
    if (origin && config.allowedOrigins.includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Credentials'] = 'true';
      headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
      headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    }
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
    try {
      if (origin && !config.allowedOrigins.includes(origin))
        throw new AiError('AUTH', '허용되지 않은 요청 출처입니다.', 403);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      // Fail closed on public deployments until shared admission and authentication are configured.
      if (!config.development && (!validPasswordHash(config.passwordHash) || !admission))
        throw new AiError(
          'CONFIGURATION',
          '공개 AI API의 인증 및 공유 요청량 제한 설정이 필요합니다.',
          503,
        );
      const path = new URL(request.url).pathname.replace(/\/$/, '');
      if (path.endsWith('/ai/login') && request.method === 'POST') {
        if (!config.passwordHash && config.development)
          return json({ authenticated: true, localOnly: true });
        if (!validPasswordHash(config.passwordHash))
          throw new AiError(
            'CONFIGURATION',
            '서버 PASSWORD에 scrypt 비밀번호 해시를 설정하세요.',
            503,
          );
        const now = Date.now(),
          attempts = (recent.get('login') ?? []).filter((t) => now - t < 60_000);
        if (
          attempts.length >= 10 ||
          loginActive >= 2 ||
          (admission && !(await admission('ai-login')))
        )
          throw new AiError(
            'RATE_LIMIT',
            '비밀번호 확인 요청이 많습니다. 잠시 후 다시 시도하세요.',
            429,
          );
        recent.set('login', [...attempts, now]);
        loginActive++;
        try {
          const password = await readPassword(request);
          if (!(await verifyPassword(password, config.passwordHash)))
            throw new AiError('AUTH', '비밀번호가 일치하지 않습니다.', 401);
          headers['Set-Cookie'] = sessionCookie(config.passwordHash, config.development);
          return json({ authenticated: true });
        } finally {
          loginActive--;
        }
      }
      if (!authenticated(request, config.passwordHash, config.development))
        throw new AiError('AUTH', 'AI 사용을 위해 비밀번호를 확인하세요.', 401);
      if (path.endsWith('/ai/capabilities') && request.method === 'GET')
        return json({
          configured: !!provider,
          provider: provider?.id ?? '',
          operations: provider?.operations ?? [],
          maxAudioBytes,
          maxAudioSeconds,
        });
      if (!path.endsWith('/ai/transcribe') || request.method !== 'POST')
        throw new AiError('UNSUPPORTED', '지원하지 않는 AI 작업입니다.', 404);
      if (!provider)
        throw new AiError('CONFIGURATION', '서버의 AI 공급자 키 또는 설정이 필요합니다.', 503);
      if (!provider.operations.includes('transcribe') || !provider.transcribe)
        throw new AiError('UNSUPPORTED', '이 공급자는 음성인식을 지원하지 않습니다.', 400);
      const identity = 'ai-service';
      if (admission && !(await admission(identity)))
        throw new AiError('RATE_LIMIT', '서비스 요청 한도에 도달했습니다.', 429);
      const now = Date.now(),
        times = (recent.get(identity) ?? []).filter((t) => now - t < 60_000);
      if (times.length >= 30 || active >= 2)
        throw new AiError(
          'RATE_LIMIT',
          '진행 중인 AI 요청이 많습니다. 잠시 후 다시 시도하세요.',
          429,
        );
      recent.set(identity, [...times, now]);
      active++;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(new Error('timeout')), LIMITS.timeoutMs);
        const signal = AbortSignal.any([request.signal, controller.signal]);
        try {
          const declared = Number(request.headers.get('content-length'));
          if (declared > maxAudioBytes + 16_384)
            throw new AiError('SIZE', '업로드가 너무 큽니다.', 413);
          if (!request.headers.get('content-type')?.startsWith('multipart/form-data'))
            throw new AiError('INPUT', '음성 파일 업로드가 필요합니다.');
          // Bound the body even when content-length is absent or dishonest.
          const reader = request.body?.getReader();
          if (!reader) throw new AiError('INPUT', '요청 본문이 없습니다.');
          const chunks: Uint8Array[] = [];
          let size = 0;
          const abort = () => {
            void reader.cancel();
          };
          signal.addEventListener('abort', abort, { once: true });
          try {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              size += chunk.value.length;
              if (size > maxAudioBytes + 16_384)
                throw new AiError('SIZE', '업로드가 너무 큽니다.', 413);
              chunks.push(chunk.value);
            }
          } finally {
            signal.removeEventListener('abort', abort);
            await reader.cancel().catch(() => {});
          }
          signal.throwIfAborted();
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
          const form = await new Response(bytes, {
            headers: { 'Content-Type': request.headers.get('content-type')! },
          }).formData();
          const file = form.get('file'),
            requestId = form.get('requestId');
          if (
            !(file instanceof File) ||
            typeof requestId !== 'string' ||
            !/^[a-zA-Z0-9_-]{1,100}$/.test(requestId)
          )
            throw new AiError('INPUT', '음성 파일 또는 요청 ID가 올바르지 않습니다.');
          if (file.size > maxAudioBytes) throw new AiError('SIZE', '음성 파일이 너무 큽니다.', 413);
          // Initial portable wire format: PCM16 mono 16 kHz WAV only.
          const wav = new DataView(await file.arrayBuffer());
          const tag = (at: number) => String.fromCharCode(...new Uint8Array(wav.buffer, at, 4));
          if (
            wav.byteLength < 46 ||
            tag(0) !== 'RIFF' ||
            tag(8) !== 'WAVE' ||
            tag(12) !== 'fmt ' ||
            wav.getUint32(16, true) !== 16 ||
            wav.getUint16(20, true) !== 1 ||
            wav.getUint16(22, true) !== 1 ||
            wav.getUint32(24, true) !== 16000 ||
            wav.getUint32(28, true) !== 32000 ||
            wav.getUint16(32, true) !== 2 ||
            wav.getUint16(34, true) !== 16 ||
            tag(36) !== 'data' ||
            wav.getUint32(40, true) !== wav.byteLength - 44 ||
            wav.getUint32(4, true) !== wav.byteLength - 8 ||
            (wav.byteLength - 44) % 2 ||
            (wav.byteLength - 44) / 32000 > maxAudioSeconds
          )
            throw new AiError('INPUT', '서버 길이 한도 내의 16kHz PCM16 모노 WAV만 지원합니다.');
          return json(await provider.transcribe(file, requestId, signal));
        } catch (error) {
          if (controller.signal.aborted)
            throw new AiError('TIMEOUT', 'AI 요청 시간이 초과됐습니다.', 504);
          if (request.signal.aborted)
            throw new AiError('CANCELLED', 'AI 요청을 취소했습니다.', 499);
          throw error;
        } finally {
          clearTimeout(timeout);
        }
      } finally {
        active--;
      }
    } catch (error) {
      const safe =
        error instanceof AiError
          ? error
          : new AiError(
              'PROVIDER',
              'AI 요청을 처리하지 못했습니다. 기존 프로젝트는 유지됩니다.',
              502,
            );
      return json({ error: { code: safe.code, message: safe.message } }, safe.status);
    }
  };
}
