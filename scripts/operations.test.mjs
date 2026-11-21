import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, statSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requirePublicOrigin, verifyDeployment } from './verify-deployment.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

function fakeResponse(status, headers = {}, json = {}) {
  return { status, headers: new Headers(headers), json: async () => json };
}

const securityHeaders = { 'strict-transport-security': 'max-age=31536000', 'x-content-type-options': 'nosniff' };

test('rejects local, credentialed and non-HTTPS production origins', () => {
  for (const url of ['http://echo.example.com', 'https://localhost', 'https://foo:bar@echo.example.com',
    'https://echo.example.com:8443', 'https://echo.example.com/path', 'https://127.0.0.1']) {
    assert.throws(() => requirePublicOrigin(url));
  }
  assert.equal(requirePublicOrigin('https://echo.example.com').origin, 'https://echo.example.com');
});

test('read-only checks validate OAuth redirect, anonymous isolation and health', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, method: options.method, redirects: options.redirect });
    if (url.startsWith('http://')) return fakeResponse(308, { location: 'https://echo.example.com/api/v1/health/live' });
    if (url.endsWith('/health/live')) return fakeResponse(200, securityHeaders, { status: 'ok' });
    if (url.endsWith('/health/ready')) return fakeResponse(200, securityHeaders, { status: 'ready' });
    if (url.endsWith('/auth/login')) return fakeResponse(302, {
      ...securityHeaders,
      location: 'https://github.com/login/oauth/authorize?client_id=abc&state=abcd',
      'set-cookie': '__Host-echo-state=abc; Secure; HttpOnly; SameSite=Lax',
    });
    return fakeResponse(401, securityHeaders, { error: 'Sign in to continue' });
  };
  const result = await verifyDeployment('https://echo.example.com', fetcher);
  assert.equal(result.length, 7);
  assert.equal(calls.length, 7);
  assert(calls.every((call) => call.redirects === 'manual'));
});

test('release gate rejects an anonymous run listing', async () => {
  const fetcher = async (url) => url.startsWith('http://') ? fakeResponse(308, { location: 'https://echo.example.com/api/v1/health/live' }) :
    url.endsWith('/auth/me') ? fakeResponse(200, securityHeaders) :
    url.endsWith('/health/live') ? fakeResponse(200, securityHeaders, { status: 'ok' }) :
    fakeResponse(200, securityHeaders, { status: 'ready' });
  await assert.rejects(() => verifyDeployment('https://echo.example.com', fetcher), /Anonymous auth\/me/);
});

test('backup validates archive, and refuses to restore onto production', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'echo-ops-'));
  try {
    const bin = path.join(scratch, 'bin');
    const backupDir = path.join(scratch, 'backups');
    mkdirSync(bin); mkdirSync(backupDir);
    const dump = path.join(bin, 'pg_dump');
    const restore = path.join(bin, 'pg_restore');
    writeFileSync(dump, '#!/bin/sh\nfor arg; do case "$arg" in --file=*) printf "PGDMPfake" > "${arg#--file=}";; esac; done\n');
    writeFileSync(restore, '#!/bin/sh\nif [ "$1" = "--list" ]; then test -s "$2"; else exit 0; fi\n');
    chmodSync(dump, 0o755); chmodSync(restore, 0o755);
    const environment = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      BACKUP_DIR: backupDir,
      DATABASE_URL: 'postgresql://user:secret@db.example.com:5432/echo',
    };
    const backup = spawnSync('bash', [path.join(scriptDirectory, 'backup-database.sh')], { env: environment, encoding: 'utf8' });
    assert.equal(backup.status, 0, backup.stderr);
    const files = readdirSync(backupDir);
    assert.equal(files.length, 1);
    assert.equal(statSync(path.join(backupDir, files[0])).mode & 0o777, 0o600);
    const sameDatabase = spawnSync('bash', [path.join(scriptDirectory, 'restore-staging.sh'), path.join(backupDir, files[0])], {
      env: { ...environment, ECHO_RESTORE_DATABASE_URL: 'postgresql://other:other@db.example.com/echo',
        ECHO_RESTORE_CONFIRM: 'RESTORE-INTO-STAGING' }, encoding: 'utf8',
    });
    assert.notEqual(sameDatabase.status, 0);
    assert.match(sameDatabase.stderr, /Refusing to restore into the source database/);
    const allowedStaging = spawnSync('bash', [path.join(scriptDirectory, 'restore-staging.sh'), path.join(backupDir, files[0])], {
      env: { ...environment, ECHO_RESTORE_DATABASE_URL: 'postgresql://other:other@staging.example.com/echo_staging',
        ECHO_RESTORE_CONFIRM: 'RESTORE-INTO-STAGING' }, encoding: 'utf8',
    });
    assert.equal(allowedStaging.status, 0, allowedStaging.stderr);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
