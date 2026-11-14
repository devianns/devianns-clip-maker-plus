import { describe, expect, it } from 'vitest';
import { emptyProject, defaultTransform } from '../src/project/model';
import { initialHistory, historyReducer } from '../src/project/commands';
import { buildResult, segmentsFor, type Draft } from '../modules/ai-gen/src/plan';
import { transcript } from '../modules/ai-api/shared/contracts';
import { createAiHandler } from '../modules/ai-api/server/handler';
import { deepseek } from '../modules/ai-api/server/providers/deepseek';

describe('AI Gen isolated result planning', () => {
  const project = () => ({
    ...emptyProject(),
    assets: [
      {
        id: 'asset',
        name: 'fixture',
        size: 1,
        lastModified: 0,
        durationUs: 60_000_000,
        width: 640,
        height: 360,
        hasAudio: true,
        videoCodec: 'avc1',
      },
    ],
    clips: [
      {
        id: 'clip',
        assetId: 'asset',
        startUs: 10_000_000,
        inUs: 5_000_000,
        outUs: 35_000_000,
        transform: defaultTransform(),
      },
    ],
  });
  it('maps a trimmed clip on the absolute timeline and bounds request duration', () => {
    const segments = segmentsFor(project(), [{ startUs: 11_000_000, endUs: 39_000_000 }]);
    expect(segments.map((s) => [s.startUs, s.endUs, s.inUs, s.outUs])).toEqual([
      [11_000_000, 26_000_000, 6_000_000, 21_000_000],
      [26_000_000, 39_000_000, 21_000_000, 34_000_000],
    ]);
  });
  it('adds a subtitle line without changing source blocks and undoes as one command', () => {
    const p = project(),
      segment = segmentsFor(p, [{ startUs: 11_000_000, endUs: 12_000_000 }])[0];
    const result = buildResult(p, [{ segment, text: '안녕하세요', state: 'success' }]);
    expect(p.subtitles).toHaveLength(0);
    expect(result.clips).toEqual(p.clips);
    expect(result.subtitles[0]).toMatchObject({
      text: '안녕하세요',
      startUs: 11_000_000,
      endUs: 12_000_000,
      lane: 1,
    });
    const next = historyReducer(initialHistory(p), {
      type: 'command',
      command: {
        type: 'replaceTimeline',
        clips: p.clips,
        subtitles: result.subtitles,
        laneCount: result.laneCount,
      },
    });
    expect(historyReducer(next, { type: 'undo' }).present).toEqual(p);
  });
  it('refuses partial failure and leaves a no-text result as a no-op', () => {
    const p = project(),
      segment = segmentsFor(p, [{ startUs: 11_000_000, endUs: 12_000_000 }])[0];
    expect(() => buildResult(p, [{ segment, text: '', state: 'failed' }])).toThrow();
    expect(buildResult(p, [{ segment, text: ' ', state: 'success' }])).toBe(p);
    const overlapping: Draft[] = [1, 2].map(() => ({ segment, text: '중복', state: 'success' }));
    expect(() => buildResult(p, overlapping)).toThrow();
  });
  it('rejects malformed provider output', () => {
    expect(() => transcript({ requestId: 'a', text: { html: 'bad' }, durationMs: 100 })).toThrow();
    expect(() => transcript({ requestId: 'a', text: 'x', durationMs: -1 })).toThrow();
  });
});
describe('AI API boundary without real upstream calls', () => {
  it('fails closed on public deployment without authentication and shared admission', async () => {
    const handler = createAiHandler({ development: false, allowedOrigins: [], key: 'fixture' });
    expect((await handler(new Request('http://localhost/api/ai/capabilities'))).status).toBe(503);
  });
  it('rejects untrusted origins and unsupported operations', async () => {
    const handler = createAiHandler({ development: true, allowedOrigins: [] });
    expect(
      (
        await handler(
          new Request('http://localhost/api/ai/capabilities', {
            headers: { origin: 'https://untrusted.invalid' },
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (await handler(new Request('http://localhost/api/ai/generateText', { method: 'POST' })))
        .status,
    ).toBe(404);
  });
  it('normalizes insufficient balance without exposing provider response', async () => {
    const provider = deepseek(
      'fixture',
      async () => new Response('private provider details', { status: 402 }),
    );
    await expect(
      provider.transcribe(new File(['a'], 'fixture.wav'), 'request', new AbortController().signal),
    ).rejects.toMatchObject({ code: 'BILLING', status: 402 });
  });
  it('passes the cancellation signal to the upstream transport', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = deepseek('fixture', async (_url, init) => {
      init?.signal?.throwIfAborted();
      return Response.json({});
    });
    await expect(
      provider.transcribe(new File(['a'], 'fixture.wav'), 'request', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
