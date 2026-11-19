import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('deployment guardrails', () => {
  it('allows a blank optional external URL in local Docker', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AUTH_MODE', 'local');
    vi.stubEnv('ECHO_EXTERNAL_URL', '');
    const { config } = await import('../src/config.js');
    expect(config.ECHO_EXTERNAL_URL).toBeUndefined();
  });

  it('refuses demo login when running in production', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_MODE', 'local');
    await expect(import('../src/config.js')).rejects.toThrow('Production requires AUTH_MODE=github');
  });

  it('refuses GitHub mode without HTTPS and credentials', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_MODE', 'github');
    vi.stubEnv('PUBLIC_ORIGIN', 'http://localhost:3001');
    await expect(import('../src/config.js')).rejects.toThrow('HTTPS PUBLIC_ORIGIN');
  });

  it('refuses operator external URLs in public mode', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_MODE', 'github');
    vi.stubEnv('PUBLIC_ORIGIN', 'https://echo.example.com');
    vi.stubEnv('GITHUB_CLIENT_ID', 'test-id');
    vi.stubEnv('GITHUB_CLIENT_SECRET', 'test-secret');
    vi.stubEnv('SESSION_SECRET', 'a'.repeat(48));
    vi.stubEnv('INTERNAL_ORACLE_SECRET', 'b'.repeat(48));
    vi.stubEnv('ECHO_EXTERNAL_URL', 'https://untrusted.example.net/trace');
    await expect(import('../src/config.js')).rejects.toThrow('disabled in public SaaS');
  });
});
