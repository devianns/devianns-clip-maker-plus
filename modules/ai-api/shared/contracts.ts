export type Operation = 'transcribe' | 'generateText';
export type ErrorCode =
  | 'CONFIGURATION'
  | 'UNSUPPORTED'
  | 'AUTH'
  | 'BILLING'
  | 'INPUT'
  | 'SIZE'
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'PROVIDER'
  | 'RESPONSE'
  | 'CANCELLED';
export class AiError extends Error {
  code: ErrorCode;
  status: number;
  constructor(code: ErrorCode, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export type Transcript = { requestId: string; text: string; durationMs: number };
export type TextRequest = { operation: 'generateText'; requestId: string; prompt: string };
export type TranscribeRequest = {
  operation: 'transcribe';
  requestId: string;
  audio: Blob;
  languageHint?: string;
};
export type AiRequest = TextRequest | TranscribeRequest;
export type TextResult = { requestId: string; text: string };
export type Capabilities = {
  configured: boolean;
  provider: string;
  operations: Operation[];
  maxAudioBytes: number;
  maxAudioSeconds: number;
};
export const LIMITS = {
  maxAudioBytes: 1_000_000,
  maxAudioSeconds: 20,
  maxSegments: 1000,
  timeoutMs: 55_000,
} as const;
export function transcript(value: unknown): Transcript {
  const v = value as Partial<Transcript> | null;
  if (
    !v ||
    typeof v.requestId !== 'string' ||
    typeof v.text !== 'string' ||
    v.text.length > 2000 ||
    typeof v.durationMs !== 'number' ||
    !Number.isFinite(v.durationMs) ||
    v.durationMs < 0 ||
    v.durationMs > 120_000
  )
    throw new AiError('RESPONSE', 'AI 응답 형식 또는 텍스트 길이가 올바르지 않습니다.', 502);
  return { requestId: v.requestId, text: v.text.trim(), durationMs: v.durationMs };
}
