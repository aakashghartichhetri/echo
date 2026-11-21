#!/usr/bin/env node
/** Read-only production probe. Does not log in, mutate accounts or perform destructive operations. */
import { pathToFileURL } from 'node:url';

export function requirePublicOrigin(input) {
  let origin;
  try { origin = new URL(input); }
  catch { throw new Error('PUBLIC_ORIGIN must be a valid HTTPS origin'); }
  if (origin.protocol !== 'https:' || origin.origin !== input || origin.username || origin.password ||
      (origin.port && origin.port !== '443') || origin.hostname === 'localhost' ||
      origin.hostname.endsWith('.localhost') || /^\d+\.\d+\.\d+\.\d+$/.test(origin.hostname)) {
    throw new Error('PUBLIC_ORIGIN must be the public HTTPS origin on port 443');
  }
  return origin;
}

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

export async function verifyDeployment(input, requester = fetch) {
  const parsed = requirePublicOrigin(input);
  const origin = parsed.origin;
  // Node fetch verifies the public certificate chain by default. Never set
  // NODE_TLS_REJECT_UNAUTHORIZED=0 to make this check pass.
  const http = await requester(`http://${parsed.hostname}/api/v1/health/live`, {
    method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10_000),
  });
  const redirectLocation = http.headers.get('location');
  ensure([301, 302, 307, 308].includes(http.status) && redirectLocation !== null &&
    new URL(redirectLocation, `http://${parsed.hostname}`).href === `${origin}/api/v1/health/live`,
    'HTTP port 80 must redirect to the HTTPS health URL');
  const check = async (path, method = 'GET') => {
    const response = await requester(`${origin}${path}`, {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: { accept: 'application/json' },
    });
    ensure(response.headers.get('strict-transport-security')?.includes('max-age='), `Missing HSTS on ${path}`);
    ensure(response.headers.get('x-content-type-options') === 'nosniff', `Missing nosniff on ${path}`);
    return response;
  };
  const live = await check('/api/v1/health/live');
  ensure(live.status === 200, `Liveness returned HTTP ${live.status}`);
  ensure((await live.json()).status === 'ok', 'Unexpected liveness response');

  const ready = await check('/api/v1/health/ready');
  ensure(ready.status === 200, `Readiness returned HTTP ${ready.status}`);
  ensure((await ready.json()).status === 'ready', 'Database is not ready');

  const anonymous = await check('/api/v1/auth/me');
  ensure(anonymous.status === 401, `Anonymous auth/me returned HTTP ${anonymous.status}; hosted mode may be unsafe`);
  const runs = await check('/api/v1/runs');
  ensure(runs.status === 401, `Anonymous runs endpoint returned HTTP ${runs.status}; hosted mode may be unsafe`);
  const create = await check('/api/v1/runs', 'POST');
  ensure(create.status === 401, `Anonymous write returned HTTP ${create.status}; hosted mode may be unsafe`);

  const login = await check('/api/v1/auth/login');
  ensure(login.status === 302, `GitHub OAuth start returned HTTP ${login.status}`);
  const location = login.headers.get('location');
  ensure(Boolean(location), 'GitHub OAuth start returned no redirect');
  const github = new URL(location);
  ensure(github.origin === 'https://github.com' && github.pathname === '/login/oauth/authorize' &&
    Boolean(github.searchParams.get('client_id')) && Boolean(github.searchParams.get('state')),
  'Unexpected OAuth redirect target');
  const cookies = login.headers.get('set-cookie') ?? '';
  ensure(cookies.includes('Secure') && cookies.includes('HttpOnly'), 'Missing secure OAuth state cookie');
  return ['Public TLS certificate and HTTP→HTTPS redirect', 'HTTPS response security headers', 'Liveness', 'Database readiness', 'Anonymous account isolation',
    'Unauthorized write protection', 'GitHub OAuth authorization redirect'];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origin = process.env.PUBLIC_ORIGIN;
  if (!origin) { console.error('Set PUBLIC_ORIGIN=https://your-domain.example'); process.exitCode = 2; }
  else {
    verifyDeployment(origin).then((checks) => {
      for (const label of checks) console.log(`PASS ${label}`);
      console.log('Read-only checks passed. REAL sign-in, database restore, and HTTPS renewal are separate manual release gates.');
    }).catch((error) => { console.error(`FAIL ${error.message}`); process.exitCode = 1; });
  }
}
