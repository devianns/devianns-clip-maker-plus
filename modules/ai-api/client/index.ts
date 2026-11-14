import {
  AiError,
  LIMITS,
  transcript,
  type Capabilities,
  type ErrorCode,
} from '../shared/contracts';
const base =
  (import.meta.env.VITE_AI_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '/api/ai';
export class AiClient {
  private async request(path: string, signal: AbortSignal, body?: FormData) {
    const response = await fetch(`${base}/${path}`, {
      method: body ? 'POST' : 'GET',
      body,
      signal: AbortSignal.any([signal, AbortSignal.timeout(LIMITS.timeoutMs + 5000)]),
      cache: 'no-store',
      credentials: 'include',
    });
    const value = await response.json().catch(() => {
      throw new AiError('RESPONSE', '자체 AI 서버 응답을 확인하세요.', 502);
    });
    if (!response.ok)
      throw new AiError(
        (value.error?.code ?? 'PROVIDER') as ErrorCode,
        value.error?.message ?? 'AI 요청 실패',
        response.status,
      );
    return value;
  }
  async login(password: string, signal: AbortSignal) {
    const response = await fetch(`${base}/login`, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const value = await response.json().catch(() => {
      throw new AiError('RESPONSE', 'AI 서버에 연결할 수 없습니다. 터미널에서 npm run dev로 웹과 AI 서버를 함께 실행하세요.');
    });
    if (!response.ok || value.authenticated !== true)
      throw new AiError(
        (value.error?.code ?? 'AUTH') as ErrorCode,
        value.error?.message ?? '비밀번호 확인에 실패했습니다.',
        response.status,
      );
  }
  async capabilities(signal: AbortSignal): Promise<Capabilities> {
    const value = await this.request('capabilities', signal);
    if (
      typeof value.configured !== 'boolean' ||
      typeof value.provider !== 'string' ||
      !Array.isArray(value.operations) ||
      !Number.isFinite(value.maxAudioBytes) ||
      !Number.isFinite(value.maxAudioSeconds)
    )
      throw new AiError('RESPONSE', 'AI 기능 정보가 올바르지 않습니다.');
    return value;
  }
  async transcribe(file: Blob, requestId: string, signal: AbortSignal) {
    const body = new FormData();
    body.set('file', file, 'speech.wav');
    body.set('requestId', requestId);
    const result = transcript(await this.request('transcribe', signal, body));
    if (result.requestId !== requestId)
      throw new AiError('RESPONSE', 'AI 요청 ID가 일치하지 않습니다.');
    return result;
  }
}
