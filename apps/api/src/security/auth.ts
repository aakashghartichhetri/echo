import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response, RequestHandler } from 'express';
import type { PrismaClient } from '@prisma/client';
import { config } from '../config.js';

const SESSION_COOKIE = '__Host-echo-session';
const STATE_COOKIE = '__Host-echo-state';
const SESSION_DAYS = 7;
const LOCAL_USER = { id: 'local-demo', login: 'local-demo', displayName: 'Local demo workspace', avatarUrl: null };

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function csrfToken(sessionToken: string): string {
  return createHmac('sha256', config.SESSION_SECRET ?? 'local-only-not-a-secret')
    .update(`csrf:${sessionToken}`).digest('hex');
}

function cookieValue(request: Request, name: string): string | undefined {
  const raw = request.headers.cookie ?? '';
  const match = raw.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  const value = match?.slice(name.length + 1);
  return value && /^[a-zA-Z0-9_-]{16,128}$/.test(value) ? value : undefined;
}

function setCookie(response: Response, name: string, value: string, maxAgeSeconds: number): void {
  response.append('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`);
}

function clearCookie(response: Response, name: string): void {
  response.append('Set-Cookie', `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

export function registerAuthRoutes(app: import('express').Express, database: PrismaClient): void {
  app.get('/api/v1/auth/login', (_request, response) => {
    if (config.AUTH_MODE === 'local') { response.redirect('/'); return; }
    const state = randomBytes(32).toString('base64url');
    setCookie(response, STATE_COOKIE, state, 600);
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', config.GITHUB_CLIENT_ID!);
    url.searchParams.set('redirect_uri', `${config.PUBLIC_ORIGIN}/api/v1/auth/callback`);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', 'read:user');
    response.redirect(302, url.toString());
  });

  app.get('/api/v1/auth/callback', async (request, response, next) => {
    if (config.AUTH_MODE !== 'github') { response.status(404).end(); return; }
    const code = typeof request.query.code === 'string' ? request.query.code : '';
    const state = typeof request.query.state === 'string' ? request.query.state : '';
    const expectedState = cookieValue(request, STATE_COOKIE);
    clearCookie(response, STATE_COOKIE);
    if (!code || code.length > 256 || !expectedState || !safeEqual(state, expectedState)) {
      response.status(400).send('Sign-in session expired. Return to ECHO and try again.');
      return;
    }
    try {
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: config.GITHUB_CLIENT_ID, client_secret: config.GITHUB_CLIENT_SECRET, code, redirect_uri: `${config.PUBLIC_ORIGIN}/api/v1/auth/callback` }),
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
      if (!tokenResponse.ok) throw new Error('GitHub token exchange failed');
      const tokenPayload: unknown = await tokenResponse.json();
      const accessToken = typeof tokenPayload === 'object' && tokenPayload !== null && 'access_token' in tokenPayload
        ? (tokenPayload as { access_token?: unknown }).access_token : undefined;
      if (typeof accessToken !== 'string' || accessToken.length < 10) throw new Error('GitHub did not authorize this sign-in');
      const userResponse = await fetch('https://api.github.com/user', {
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/vnd.github+json', 'user-agent': 'echo-behavior-lab' },
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
      if (!userResponse.ok) throw new Error('Could not read GitHub account');
      const github: unknown = await userResponse.json();
      if (!github || typeof github !== 'object') throw new Error('Invalid GitHub profile');
      const profile = github as { id?: unknown; login?: unknown; name?: unknown; avatar_url?: unknown };
      if (typeof profile.id !== 'number' || !Number.isSafeInteger(profile.id) || typeof profile.login !== 'string' || !/^[a-zA-Z0-9-]{1,39}$/.test(profile.login)) {
        throw new Error('Invalid GitHub user identifier');
      }
      const githubId = String(profile.id);
      const login = profile.login;
      const displayName = typeof profile.name === 'string' && profile.name.trim() ? profile.name.slice(0, 100) : login;
      const avatarUrl = typeof profile.avatar_url === 'string' && profile.avatar_url.startsWith('https://avatars.githubusercontent.com/')
        ? profile.avatar_url.slice(0, 500) : null;
      const user = await database.user.upsert({
        where: { githubId },
        create: { githubId, login, displayName, avatarUrl },
        update: { login, displayName, avatarUrl, lastLoginAt: new Date() },
      });
      // Keep only a small number of live sessions for a single account.
      const older = await database.session.findMany({
        where: { userId: user.id }, orderBy: { createdAt: 'desc' }, skip: 9, select: { tokenHash: true },
      });
      if (older.length) await database.session.deleteMany({ where: { tokenHash: { in: older.map((item) => item.tokenHash) } } });
      const token = randomBytes(32).toString('base64url');
      await database.session.create({
        data: { tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000) },
      });
      setCookie(response, SESSION_COOKIE, token, SESSION_DAYS * 86400);
      response.redirect(303, '/');
    } catch (error) {
      // Never log the OAuth code or access token.
      console.error(JSON.stringify({ event: 'oauth_failure', message: error instanceof Error ? error.message : 'Unexpected auth error' }));
      next(new Error('Could not complete GitHub sign-in'));
    }
  });

  app.get('/api/v1/auth/me', authenticate(database), (request, response) => {
    response.json({ user: response.locals.user, csrfToken: config.AUTH_MODE === 'local' ? 'local' : csrfToken(response.locals.sessionToken) });
  });

  app.post('/api/v1/auth/logout', authenticate(database), requireCsrf, async (request, response, next) => {
    try {
      if (config.AUTH_MODE === 'github') {
        await database.session.deleteMany({ where: { tokenHash: hashToken(response.locals.sessionToken), userId: response.locals.userId } });
        clearCookie(response, SESSION_COOKIE);
      }
      response.status(204).end();
    } catch (error) { next(error); }
  });
}

export function authenticate(database: PrismaClient): RequestHandler {
  return async (request, response, next) => {
    if (config.AUTH_MODE === 'local') {
      response.locals.userId = LOCAL_USER.id;
      response.locals.user = LOCAL_USER;
      response.locals.sessionToken = 'local';
      next();
      return;
    }
    const token = cookieValue(request, SESSION_COOKIE);
    if (!token) { response.status(401).json({ error: 'Sign in to continue' }); return; }
    try {
      const session = await database.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
      if (!session || session.expiresAt <= new Date()) {
        clearCookie(response, SESSION_COOKIE);
        response.status(401).json({ error: 'Your session expired. Please sign in again.' });
        return;
      }
      response.locals.userId = session.userId;
      response.locals.sessionToken = token;
      response.locals.user = { id: session.user.id, login: session.user.login, displayName: session.user.displayName, avatarUrl: session.user.avatarUrl };
      next();
    } catch (error) { next(error); }
  };
}

export const requireCsrf: RequestHandler = (request, response, next) => {
  if (config.AUTH_MODE === 'local' || ['GET', 'HEAD', 'OPTIONS'].includes(request.method)) { next(); return; }
  const origin = request.get('origin');
  // Origin is checked in addition to the session-bound CSRF token.
  if (origin !== config.PUBLIC_ORIGIN || !safeEqual(request.get('x-csrf-token') ?? '', csrfToken(response.locals.sessionToken))) {
    response.status(403).json({ error: 'Security check failed. Refresh the page and try again.' });
    return;
  }
  next();
};
