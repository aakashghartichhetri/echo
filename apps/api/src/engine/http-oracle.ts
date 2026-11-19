import { z } from 'zod';
import type { TraceOracle } from './types.js';

const responseSchema = z.object({ outputs: z.array(z.string().max(100)).max(32) });

/** Replaying each trace against a fresh sandbox instance avoids state leakage. */
export class HttpTraceOracle implements TraceOracle {
  constructor(private readonly url: string, private readonly targetId: string, private readonly internalSecret?: string) {}

  async trace(actions: string[], signal?: AbortSignal): Promise<string[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('Oracle timeout'), 5000);
    const forwardAbort = () => controller.abort('Run cancelled');
    signal?.addEventListener('abort', forwardAbort, { once: true });
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.internalSecret ? { 'x-echo-internal-secret': this.internalSecret } : {}) },
        body: JSON.stringify({ targetId: this.targetId, actions }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Target returned HTTP ${response.status}`);
      const decoded = responseSchema.safeParse(await response.json());
      if (!decoded.success || decoded.data.outputs.length !== actions.length) {
        throw new Error('Target returned an invalid output trace');
      }
      return decoded.data.outputs;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }
}
