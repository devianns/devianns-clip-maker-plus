import { randomBytes, scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { authenticated, sessionCookie, verifyPassword } from '../modules/ai-api/server/password';
import { createAiHandler } from '../modules/ai-api/server/handler';
const password='local-fixture-only';
const salt=randomBytes(16);
const hash=`scrypt$${salt.toString('hex')}$${scryptSync(password,salt,64).toString('hex')}`;
describe('AI password authentication',()=>{
  it('accepts the original password and rejects wrong passwords and plaintext settings',async()=>{
    expect(await verifyPassword(password,hash)).toBe(true);
    expect(await verifyPassword('wrong',hash)).toBe(false);
    expect(await verifyPassword(password,password)).toBe(false);
  });
  it('requires a valid signed cookie and invalidates it on password rotation',()=>{
    const cookie=sessionCookie(hash,false).split(';')[0];
    expect(authenticated(new Request('https://app.invalid/api/ai/capabilities',{headers:{cookie}}),hash,false)).toBe(true);
    expect(authenticated(new Request('https://app.invalid/api/ai/capabilities',{headers:{cookie:cookie+'x'}}),hash,false)).toBe(false);
    expect(authenticated(new Request('https://app.invalid/api/ai/capabilities',{headers:{cookie}}),hash.replace(/.$/,hash.endsWith('0')?'1':'0'),false)).toBe(false);
    expect(authenticated(new Request('https://app.invalid/api/ai/capabilities'),undefined,false)).toBe(false);
  });
  it('blocks direct API access before login and issues a secure HttpOnly session after login',async()=>{
    const handle=createAiHandler({development:false,passwordHash:hash,allowedOrigins:['https://app.invalid']},async()=>true);
    expect((await handle(new Request('https://app.invalid/api/ai/capabilities'))).status).toBe(401);
    const login=await handle(new Request('https://app.invalid/api/ai/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://app.invalid'},body:JSON.stringify({password})}));
    expect(login.status).toBe(200);
    expect(login.headers.get('set-cookie')).toContain('HttpOnly');
    expect(login.headers.get('set-cookie')).toContain('Secure');
    const response=await handle(new Request('https://app.invalid/api/ai/capabilities',{headers:{cookie:login.headers.get('set-cookie')!.split(';')[0]}}));
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(hash);
  });
});
