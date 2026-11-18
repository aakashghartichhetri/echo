import type { LearnOptions } from '../engine/types.js';

export const DEFAULTS: Record<string, LearnOptions> = {
  'rate-limiter': { accessDepth: 3, suffixDepth: 3, verifyDepth: 8, queryLimit: 2500, findingLimit: 1 },
  authentication: { accessDepth: 3, suffixDepth: 2, verifyDepth: 4, queryLimit: 3000, findingLimit: 1 },
  external: { accessDepth: 3, suffixDepth: 2, verifyDepth: 4, queryLimit: 3000, findingLimit: 1 },
};
