import { createAiHandler, type Admission } from '../modules/ai-api/server/handler.ts';
export function configuredHandler(development = false) {
  const limiterUrl = process.env.AI_ADMISSION_URL;
  const limiterToken = process.env.AI_ADMISSION_TOKEN;
  const admission: Admission | undefined =
    limiterUrl && limiterToken
      ? async (identity) => {
          // Deployment-owned shared service: {allowed:boolean}; never sends media or provider keys.
          const response = await fetch(limiterUrl, {
            method: 'POST',
            signal: AbortSignal.timeout(3000),
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${limiterToken}`,
            },
            body: JSON.stringify({ identity, limit: 30, windowSeconds: 60 }),
          });
          if (!response.ok) return false;
          const result = await response.json();
          return result.allowed === true;
        }
      : undefined;
  return createAiHandler(
    {
      key: process.env.DEEPSEEK_API_KEY,
      provider: process.env.AI_PROVIDER ?? 'deepseek',
      passwordHash: process.env.PASSWORD,
      allowedOrigins: (
        process.env.AI_ALLOWED_ORIGINS ??
        (development ? 'http://127.0.0.1:5173,http://localhost:5173' : '')
      )
        .split(',')
        .filter(Boolean),
      development,
    },
    admission,
  );
}
