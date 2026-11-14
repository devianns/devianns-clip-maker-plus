import { expect, it } from 'vitest';
import { openai } from '../modules/ai-api/server/providers/openai';
it('uses OpenAI multipart transcription and normalizes text without inventing timestamps', async () => {
  const bytes = new ArrayBuffer(44 + 32000),
    view = new DataView(bytes);
  view.setUint32(28, 32000, true);
  const provider = openai('fixture', 'gpt-transcribe', async (url, init) => {
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect((init?.body as FormData).get('model')).toBe('gpt-transcribe');
    return Response.json({ text: '안녕하세요' });
  });
  expect(
    await provider.transcribe(
      new File([bytes], 'fixture.wav'),
      'test',
      new AbortController().signal,
    ),
  ).toEqual({ requestId: 'test', text: '안녕하세요', durationMs: 1000 });
});
it('distinguishes quota exhaustion from transient rate limiting', async () => {
  const file = new File(['fixture'], 'fixture.wav');
  const billing = openai('fixture', 'gpt-transcribe', async () =>
    Response.json({ error: { code: 'insufficient_quota' } }, { status: 429 }),
  );
  const rate = openai('fixture', 'gpt-transcribe', async () =>
    Response.json({ error: { code: 'rate_limit_exceeded' } }, { status: 429 }),
  );
  await expect(
    billing.transcribe(file, 'test', new AbortController().signal),
  ).rejects.toMatchObject({ code: 'BILLING' });
  await expect(rate.transcribe(file, 'test', new AbortController().signal)).rejects.toMatchObject({
    code: 'RATE_LIMIT',
  });
});
