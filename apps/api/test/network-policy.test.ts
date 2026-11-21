import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { addressAllowed, validateOracleUrl } from '../src/engine/network-policy.js';
import { HttpTraceOracle } from '../src/engine/http-oracle.js';

let server: Server | undefined;
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  server = undefined;
});

async function fixture(handler: RequestListener): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/trace`;
}

describe('outbound HTTP restrictions', () => {
  it('rejects private, metadata, loopback, mapped IPv6 and unsafe schemes', () => {
    for (const ip of ['127.0.0.1', '10.4.5.6', '169.254.169.254', '192.168.5.1', '::1', '::ffff:127.0.0.1', '64:ff9b::7f00:1', 'fc00::1']) {
      expect(addressAllowed(ip)).toBe(false);
    }
    expect(addressAllowed('127.0.0.1', true)).toBe(true);
    expect(addressAllowed('8.8.8.8')).toBe(true);
    expect(() => validateOracleUrl('http://169.254.169.254/latest/meta-data')).toThrow();
    expect(() => validateOracleUrl('https://[::1]/trace')).toThrow();
    expect(() => validateOracleUrl('https://user:pass@example.com/trace')).toThrow();
    expect(() => validateOracleUrl('file:///etc/passwd')).toThrow();
    expect(() => validateOracleUrl('https://example.com:4443/trace')).toThrow();
  });

  it('does not follow a redirect to private resources', async () => {
    let hits = 0;
    const url = await fixture((_req, response) => {
      hits += 1;
      response.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' }).end();
    });
    await expect(new HttpTraceOracle(url, 'rate-limiter', undefined, true).trace(['request']))
      .rejects.toThrow(/HTTP 302/);
    expect(hits).toBe(1);
  });

  it('limits response bytes even without Content-Length', async () => {
    const url = await fixture((_req, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ outputs: ['x'.repeat(32_000)] }));
    });
    await expect(new HttpTraceOracle(url, 'rate-limiter', undefined, true).trace(['request']))
      .rejects.toThrow(/size limit/);
  });

  it('rejects invalid JSON from an upstream service', async () => {
    const url = await fixture((_req, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end('{not-json');
    });
    await expect(new HttpTraceOracle(url, 'rate-limiter', undefined, true).trace(['request']))
      .rejects.toThrow(/valid JSON/);
  });

  it('times out an unresponsive upstream service', async () => {
    const url = await fixture(() => { /* Intentionally never complete the response. */ });
    await expect(new HttpTraceOracle(url, 'rate-limiter', undefined, true).trace(['request']))
      .rejects.toThrow();
  }, 9_000);

  it('honors user cancellation without retrying a POST', async () => {
    let requests = 0;
    let observed!: () => void;
    const received = new Promise<void>((resolve) => { observed = resolve; });
    const url = await fixture((_req, response) => { requests += 1; observed(); /* Keep response pending. */ void response; });
    const abort = new AbortController();
    const result = new HttpTraceOracle(url, 'rate-limiter', undefined, true).trace(['request'], abort.signal);
    await received;
    abort.abort();
    await expect(result).rejects.toThrow();
    expect(requests).toBe(1);
  });
});
