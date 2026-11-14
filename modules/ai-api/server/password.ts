import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { AiError } from '../shared/contracts.ts';

const COOKIE = 'ai_session';
const MAX_AGE = 3600;
export function validPasswordHash(hash: string | undefined): hash is string {
  return !!hash && /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(hash);
}
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!validPasswordHash(hash) || !password || Buffer.byteLength(password) > 512) return false;
  const [, salt, expected] = hash.split('$');
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1 }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
  return timingSafeEqual(derived, Buffer.from(expected, 'hex'));
}
const signature = (payload: string, hash: string) =>
  createHmac('sha256', hash).update(`ai-session:${payload}`).digest('hex');
export function sessionCookie(hash: string, development: boolean) {
  const payload = `${Math.floor(Date.now() / 1000) + MAX_AGE}.${randomBytes(16).toString('hex')}`;
  return `${COOKIE}=${payload}.${signature(payload, hash)}; HttpOnly; SameSite=Strict; Path=/api/ai; Max-Age=${MAX_AGE}${development ? '' : '; Secure'}`;
}
export function authenticated(request: Request, hash: string | undefined, development: boolean) {
  if (!hash && development) return true;
  if (!validPasswordHash(hash)) return false;
  const value = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!value || !/^\d{10}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(value)) return false;
  const [expires, nonce, sig] = value.split('.');
  const time = Number(expires),
    now = Math.floor(Date.now() / 1000);
  if (time <= now || time > now + MAX_AGE) return false;
  return timingSafeEqual(
    Buffer.from(sig, 'hex'),
    Buffer.from(signature(`${expires}.${nonce}`, hash), 'hex'),
  );
}
export async function readPassword(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new AiError('INPUT', '비밀번호 입력 형식이 올바르지 않습니다.');
  const reader = request.body?.getReader();
  if (!reader) throw new AiError('INPUT', '비밀번호를 입력하세요.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  const timer = setTimeout(() => {
    void reader.cancel();
  }, 5000);
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 2048) throw new AiError('INPUT', '비밀번호 입력이 너무 깁니다.');
      chunks.push(part.value);
    }
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof value.password !== 'string' || Buffer.byteLength(value.password) > 512)
      throw new Error();
    return value.password as string;
  } catch {
    throw new AiError('INPUT', '비밀번호를 올바르게 입력하세요.');
  }
}
