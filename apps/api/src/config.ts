import { z } from 'zod';

// An empty Compose variable disables the optional integration; it is never a URL.
const optionalText = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().optional(),
);

const parsed = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  AUTH_MODE: z.enum(['local', 'github']).default('local'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().min(1).default('postgresql://echo:echo_local_only@localhost:5432/echo?schema=public'),
  ORACLE_BASE_URL: z.string().url().default('http://127.0.0.1:3001'),
  PUBLIC_ORIGIN: optionalText,
  GITHUB_CLIENT_ID: optionalText,
  GITHUB_CLIENT_SECRET: optionalText,
  SESSION_SECRET: optionalText,
  INTERNAL_ORACLE_SECRET: optionalText,
  ECHO_EXTERNAL_URL: optionalText,
  ECHO_EXTERNAL_ACTIONS: optionalText,
  ECHO_RATE_LIMITER_MODE: z.enum(['reference', 'patched']).default('reference'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(2).default(0),
  DAILY_RUN_LIMIT: z.coerce.number().int().min(1).max(100).default(20),
}).safeParse(process.env);

if (!parsed.success) throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
export const config = parsed.data;

if (config.NODE_ENV === 'production' && config.AUTH_MODE !== 'github') {
  throw new Error('Production requires AUTH_MODE=github. Local demo authentication must never be public.');
}
if (config.AUTH_MODE === 'github') {
  const origin = config.PUBLIC_ORIGIN;
  if (!origin || !/^https:\/\/[^/]+$/.test(origin) ||
      !config.GITHUB_CLIENT_ID || !config.GITHUB_CLIENT_SECRET ||
      !config.SESSION_SECRET || config.SESSION_SECRET.length < 32 ||
      !config.INTERNAL_ORACLE_SECRET || config.INTERNAL_ORACLE_SECRET.length < 32) {
    throw new Error('GitHub login requires HTTPS PUBLIC_ORIGIN, GitHub OAuth credentials and 32+ character session/internal secrets');
  }
  if (config.ECHO_EXTERNAL_URL) {
    throw new Error('External oracle targets are disabled in public SaaS mode to prevent SSRF');
  }
}
if (config.ECHO_EXTERNAL_URL && !/^https?:\/\//.test(config.ECHO_EXTERNAL_URL)) {
  throw new Error('External oracle URL must use HTTP(S)');
}

if (config.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
  throw new Error('Production requires an explicit DATABASE_URL');
}
