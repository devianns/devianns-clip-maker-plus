import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { configuredHandler } from './config.ts';
import { serveRequest } from './adapter.ts';
const development = process.argv.includes('--dev');
if (development && existsSync('.env.local')) process.loadEnvFile('.env.local');
const handler = configuredHandler(development);
const server = createServer((req, res) => {
  void serveRequest(req, res, handler);
});
server.requestTimeout = 60_000;
server.headersTimeout = 15_000;
const port = Number(process.env.AI_PORT ?? 8787);
const host = process.env.AI_HOST ?? '127.0.0.1';
server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(error.code === 'EADDRINUSE'
    ? `AI 서버 포트 ${port}가 이미 사용 중입니다. 이전 개발 서버를 종료한 뒤 다시 실행하세요.`
    : `AI 서버 시작 실패 (${error.code ?? 'unknown'})`);
  process.exitCode = 1;
});
server.listen(port, host, () => console.log(`AI API server ready: http://${host}:${port}`));
function shutdown() {
  server.close();
  setTimeout(() => {
    server.closeAllConnections();
  }, 1000).unref();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
