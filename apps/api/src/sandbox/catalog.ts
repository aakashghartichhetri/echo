import type { TargetDescriptor } from '../engine/types.js';
import { BUILTIN_TARGETS } from './targets.js';

/** External URLs are operator-configured only, never accepted from API callers. */
export function createCatalog(externalUrl?: string, externalActions?: string): TargetDescriptor[] {
  const targets = BUILTIN_TARGETS.map((target) => ({ ...target, actions: [...target.actions] }));
  if (externalUrl) {
    const actions = externalActions?.split(',').map((part) => part.trim()).filter(Boolean) ?? [];
    if (actions.length < 2 || actions.length > 5 || new Set(actions).size !== actions.length || actions.some((a) => !/^[a-z][a-z0-9-]{0,30}$/.test(a))) {
      throw new Error('ECHO_EXTERNAL_ACTIONS must list 2–5 distinct lowercase actions');
    }
    targets.push({
      id: 'external',
      name: 'Configured external API',
      summary: 'Operator-supplied trace endpoint, fixed at server startup.',
      contract: 'Defined by the operator; output discrepancies require human review.',
      actions,
      expectedAnomaly: null,
    });
  }
  return targets;
}
