#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo 'Docker Desktop / Docker Compose is required: https://docs.docker.com/get-docker/' >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo 'Docker Compose v2 is required.' >&2
  exit 1
fi

# The standalone ZIP starts without Git history. Restore the original audited
# lockfile from a pinned commit, checking its Git object hash before use.
if [ ! -s package-lock.json ]; then
  echo 'Restoring the pinned dependency lockfile...'
  bash scripts/restore-lockfile.sh
fi

echo 'Building and starting ECHO...'
docker compose up -d --build --remove-orphans
echo ''
echo 'ECHO dashboard: http://localhost:3001'
echo 'Check container health: docker compose ps'
echo 'Run all checks: ./verify-local.sh'
