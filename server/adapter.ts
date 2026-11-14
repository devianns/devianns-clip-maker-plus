import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
export async function serveRequest(
  req: IncomingMessage,
  res: ServerResponse,
  handle: (request: Request) => Promise<Response>,
) {
  const controller = new AbortController();
  const cancel = () => {
    if (!res.writableEnded) controller.abort();
  };
  req.once('aborted', cancel);
  res.once('close', cancel);
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers))
      if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
    const init: RequestInit & { duplex?: 'half' } = {
      method: req.method,
      headers,
      signal: controller.signal,
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
      init.duplex = 'half';
    }
    const request = new Request(new URL(req.url ?? '/', 'http://ai.internal'), init);
    const response = await handle(request);
    if (res.destroyed) return;
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    if (!res.headersSent)
      res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    if (!res.destroyed)
      res.end(JSON.stringify({ error: { code: 'PROVIDER', message: 'AI 서버 요청 처리 실패' } }));
  } finally {
    req.off('aborted', cancel);
    res.off('close', cancel);
  }
}
