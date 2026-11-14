import type { Operation, Transcript, TextRequest, TextResult } from '../shared/contracts.ts';
export interface Provider {
  id: string;
  operations: Operation[];
  audioLimits?: { maxAudioBytes: number; maxAudioSeconds: number };
  transcribe?(file: File, requestId: string, signal: AbortSignal): Promise<Transcript>;
  generateText?(request: TextRequest, signal: AbortSignal): Promise<TextResult>;
}
