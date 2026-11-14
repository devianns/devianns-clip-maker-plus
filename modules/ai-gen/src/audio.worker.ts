import { openMedia, type OpenMedia } from '../../../src/media/input';
import { Pcm16Reader } from '../../speech-auto-cut/src/pcm-reader';
import type { Segment } from './plan';
self.onmessage = async (event: MessageEvent<{ file: File; segment: Segment }>) => {
  let media: OpenMedia | undefined, reader: Pcm16Reader | undefined;
  try {
    const { file, segment } = event.data;
    const duration = segment.outUs - segment.inUs;
    if (duration <= 0 || duration > 20_000_000)
      throw new Error('음성 조각 길이가 올바르지 않습니다.');
    media = await openMedia(file, segment.assetId);
    if (!media.audio) throw new Error('원본 오디오가 없습니다.');
    const samples = Math.ceil((duration * 16000) / 1_000_000);
    const buffer = new ArrayBuffer(44 + samples * 2),
      view = new DataView(buffer);
    const tag = (at: number, text: string) => {
      for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
    };
    tag(0, 'RIFF');
    view.setUint32(4, buffer.byteLength - 8, true);
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
    view.setUint32(40, samples * 2, true);
    reader = new Pcm16Reader(
      media,
      media.origin + segment.inUs / 1_000_000,
      media.origin + segment.outUs / 1_000_000,
    );
    for await (const frame of reader.frames()) {
      // Dominant-energy channel per frame avoids discarding right-channel speech or phase cancellation.
      const channel = frame.channels.reduce((best, current) => {
        const energy = (v: Float32Array) => v.reduce((sum, x) => sum + x * x, 0);
        return energy(current) > energy(best) ? current : best;
      });
      for (let i = 0; i < frame.count && frame.offset + i < samples; i++) {
        const value = Math.max(-1, Math.min(1, channel[i]));
        view.setInt16(
          44 + (frame.offset + i) * 2,
          Math.round(value * (value < 0 ? 32768 : 32767)),
          true,
        );
      }
    }
    self.postMessage({ buffer }, { transfer: [buffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '음성 추출 실패' });
  } finally {
    await reader?.close().catch(() => {});
    media?.input.dispose();
  }
};
