#!/usr/bin/env bash
# Creates an owner-only PostgreSQL custom-format backup and verifies its table of contents.
set -Eeuo pipefail
umask 077
: "${DATABASE_URL:?Set DATABASE_URL to the database you intend to back up}"
: "${BACKUP_DIR:?Set BACKUP_DIR to a private directory outside the repository}"
for executable in pg_dump pg_restore; do
  command -v "$executable" >/dev/null || { echo "Missing $executable (PostgreSQL client tools required)" >&2; exit 1; }
done
mkdir -p -- "$BACKUP_DIR"
[[ -d "$BACKUP_DIR" && ! -L "$BACKUP_DIR" ]] || { echo 'BACKUP_DIR must be a real directory' >&2; exit 1; }
output="$BACKUP_DIR/echo-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
partial=$(mktemp "$BACKUP_DIR/.echo-backup-XXXXXXXX")
cleanup() { rm -f -- "$partial"; }
trap cleanup EXIT
PGDATABASE="$DATABASE_URL" pg_dump --format=custom --no-owner --no-acl --file="$partial"
[[ -s "$partial" ]] || { echo 'Backup was empty' >&2; exit 1; }
pg_restore --list "$partial" >/dev/null
chmod 600 "$partial"
mv -n -- "$partial" "$output"
[[ -s "$output" ]] || { echo 'Could not finalize backup' >&2; exit 1; }
printf 'Backup verified: %s\n' "$output"
