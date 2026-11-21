#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
TS="$ROOT/apps/api/src"
tsc --strict --skipLibCheck --noUncheckedIndexedAccess --exactOptionalPropertyTypes \
  --target ES2022 --lib ES2022,DOM --module NodeNext --moduleResolution NodeNext \
  --rootDir "$TS" --outDir "$OUT" \
  "$TS/engine/types.ts" "$TS/engine/sequences.ts" "$TS/engine/learner.ts" "$TS/engine/compare.ts" \
  "$TS/sandbox/targets.ts" "$TS/service/defaults.ts"
printf '{"type":"module"}\n' > "$OUT/package.json"
node "$ROOT/scripts/benchmark-core.mjs" "$OUT"
