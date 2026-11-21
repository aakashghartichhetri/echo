import { lookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { z } from 'zod';
import type { TraceOracle } from './types.js';
import { addressAllowed, validateOracleUrl } from './network-policy.js';

const MAX_RESPONSE_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;
const responseSchema = z.object({ outputs: z.array(z.string().max(100)).max(32) });

/** Send one bounded request, pinning DNS resolution to a checked address. */
function postTrace(url: URL, body: string, internalSecret: string | undefined,
  signal: AbortSignal | undefined, allowLoopback: boolean): Promise<unknown> {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(url, {
      method: 'POST', signal: combinedSignal,
      headers: {
        'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
        accept: 'application/json',
        ...(internalSecret ? { 'x-echo-internal-secret': internalSecret } : {}),
      },
      // Validate every DNS answer and pin the connection to one of them.
      // A second DNS resolution during connection would enable DNS rebinding.
      lookup(hostname, _options, callback) {
        lookup(hostname, { all: true }, (error, records) => {
          if (error) { callback(error, '', 0); return; }
          if (!records?.length || records.some((item) => !addressAllowed(item.address, allowLoopback))) {
            callback(new Error('Oracle hostname resolves to a blocked address'), '', 0);
            return;
          }
          callback(null, records[0]!.address, records[0]!.family);
        });
      },
    }, (response) => {
      // Never follow redirects: even a trusted endpoint could redirect to a private IP.
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Target returned HTTP ${response.statusCode ?? 'unknown'} (redirects are disabled)`));
        return;
      }
      const contentLength = Number(response.headers['content-length']);
      if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
        reject(new Error('Oracle response exceeds the size limit'));
        response.destroy();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          reject(new Error('Oracle response exceeds the size limit'));
          response.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.once('error', reject);
      response.once('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown); }
        catch { reject(new Error('Oracle response is not valid JSON')); }
      });
    });
    request.once('error', reject);
    request.end(body);
  });
}

/** Every trace replays from a fresh target state; failed requests are never cached. */
export class HttpTraceOracle implements TraceOracle {
  constructor(private readonly url: string, private readonly targetId: string,
    private readonly internalSecret?: string, private readonly allowLocalExternal = false) {}

  async trace(actions: string[], signal?: AbortSignal): Promise<string[]> {
    const allowLoopback = Boolean(this.internalSecret) || this.allowLocalExternal;
    const url = validateOracleUrl(this.url, allowLoopback);
    const payload = await postTrace(url, JSON.stringify({ targetId: this.targetId, actions }),
      this.internalSecret, signal, allowLoopback);
    const decoded = responseSchema.safeParse(payload);
    if (!decoded.success || decoded.data.outputs.length !== actions.length) {
      throw new Error('Target returned an invalid output trace');
    }
    return decoded.data.outputs;
  }
}
