#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! docker compose ps --status running --services | grep -qx 'app'; then
  echo 'ECHO app is not running. Start it with ./start.sh first.' >&2
  exit 1
fi

echo '[1/6] Source checks'
docker compose exec -T app npm run lint
echo '[2/6] TypeScript checks'
docker compose exec -T app npm run typecheck
echo '[3/6] Unit and HTTP tests'
docker compose exec -T app npm test
echo '[4/6] PostgreSQL integration tests'
docker compose exec -T -e RUN_DB_TESTS=1 app npm run test -w @echo/api
echo '[5/6] HTTP end-to-end smoke checks'
docker compose exec -T app npm run smoke
echo '[6/6] Production dependency audit'
docker compose exec -T app npm audit --omit=dev --audit-level=high

echo 'All ECHO local checks passed.'
