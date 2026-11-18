/** Yield traces in increasing length, then alphabet order. */
export function* sequencesThroughDepth(actions: readonly string[], maxDepth: number): Generator<string[]> {
  let level: string[][] = [[]];
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    level = level.flatMap((prefix) => actions.map((action) => [...prefix, action]));
    yield* level;
  }
}

export function sequenceCount(alphabetSize: number, depth: number): number {
  let count = 0;
  for (let length = 1; length <= depth; length += 1) count += alphabetSize ** length;
  return count;
}

export function predict(machine: { initialState: number; transitions: {
  from: number; action: string; output: string; to: number;
}[] }, actions: readonly string[]): string[] {
  const edges = new Map(machine.transitions.map((edge) => [`${edge.from}:${edge.action}`, edge]));
  let current = machine.initialState;
  return actions.map((action) => {
    const edge = edges.get(`${current}:${action}`);
    if (!edge) throw new Error(`Incomplete model for state ${current}, action ${action}`);
    current = edge.to;
    return edge.output;
  });
}
