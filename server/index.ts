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
server.listen(Number(process.env.AI_PORT ?? 8787), process.env.AI_HOST ?? '127.0.0.1', () =>
  console.log('AI API server ready'),
);
function shutdown() {
  server.close();
  setTimeout(() => {
    server.closeAllConnections();
  }, 1000).unref();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
