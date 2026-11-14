import type { Segment } from './plan';
export function extractAudio(file: File, segment: Segment, signal: AbortSignal): Promise<Blob> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL('./audio.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
      signal.removeEventListener('abort', cancel);
    };
    const cancel = () => {
      finish();
      reject(new DOMException('취소했습니다.', 'AbortError'));
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error('음성 추출 시간이 초과됐습니다.'));
    }, 60_000);
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (event: MessageEvent<{ buffer?: ArrayBuffer; error?: string }>) => {
      finish();
      if (event.data.buffer) resolve(new Blob([event.data.buffer], { type: 'audio/wav' }));
      else reject(new Error(event.data.error ?? '음성 추출 실패'));
    };
    worker.onerror = () => {
      finish();
      reject(new Error('음성 추출 Worker 오류'));
    };
    try {
      worker.postMessage({ file, segment });
    } catch (error) {
      finish();
      reject(error);
    }
  });
}
