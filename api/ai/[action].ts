import type { IncomingMessage, ServerResponse } from 'node:http';
import { configuredHandler } from '../../server/config.ts';
import { serveRequest } from '../../server/adapter.ts';
const handle = configuredHandler(false);
export const config = { api: { bodyParser: false } };
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await serveRequest(req, res, handle);
}
