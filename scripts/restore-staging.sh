#!/usr/bin/env bash
# Only restore into an explicitly named, isolated STAGING database; never restore into production.
set -Eeuo pipefail
[[ $# -eq 1 && -f "$1" ]] || { echo 'Usage: restore-staging.sh /private/path/echo-YYYYMMDD.dump' >&2; exit 2; }
: "${ECHO_RESTORE_DATABASE_URL:?Set ECHO_RESTORE_DATABASE_URL to the EMPTY staging database}"
: "${DATABASE_URL:?Set DATABASE_URL to the production/source database URL for the safety comparison}"
[[ "${ECHO_RESTORE_CONFIRM:-}" == 'RESTORE-INTO-STAGING' ]] || {
  echo 'Set ECHO_RESTORE_CONFIRM=RESTORE-INTO-STAGING to confirm the staging restore' >&2; exit 2;
}
for executable in pg_restore node; do
  command -v "$executable" >/dev/null || { echo "Missing $executable" >&2; exit 1; }
done
# Compare server/database identity, ignoring usernames and passwords. Reject ambiguous URL formats.
node --input-type=module -e '
const source = new URL(process.env.DATABASE_URL);
const target = new URL(process.env.ECHO_RESTORE_DATABASE_URL);
if (![source, target].every(u => ["postgres:", "postgresql:"].includes(u.protocol) && u.hostname && u.pathname.length > 1)) {
  throw new Error("Provide complete PostgreSQL connection URLs");
}
const fingerprint = u => [u.hostname.toLowerCase(), u.port || "5432", decodeURIComponent(u.pathname)].join(":");
if (fingerprint(source) === fingerprint(target)) throw new Error("Refusing to restore into the source database");
if (!/(^|[-_.])(?:staging|restore|drill)([-_.]|$)/i.test(decodeURIComponent(target.pathname))) {
  throw new Error("Staging database name must contain staging, restore, or drill");
}
'
pg_restore --list "$1" >/dev/null
# The staging database must be new and empty; no --clean or --create options are used.
PGDATABASE="$ECHO_RESTORE_DATABASE_URL" pg_restore --exit-on-error --no-owner --no-acl "$1"
echo 'Staging restore finished. Verify the application and row counts before declaring the backup usable.'
