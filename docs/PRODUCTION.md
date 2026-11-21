# ECHO deployment and recovery runbook

**Scope:** one API/container replica, one bounded in-process experiment worker, GitHub OAuth, Caddy HTTPS, and a provider-managed PostgreSQL database. This document is a deployment procedure, **not proof of a live deployment**. Do not enable arbitrary third-party HTTP targets in public mode.

## 1. Prerequisites and trust boundary

- Linux server with supported Docker Engine and Docker Compose v2, inbound TCP 80/443 and UDP 443, outbound 443, persistent Caddy volumes, DNS access, and a hostname you control.
- Managed PostgreSQL with TLS, restricted network access, service-account credentials, automated provider snapshots, and an independent off-host backup destination. Follow the provider's certificate-validation requirements (`verify-full` plus a trusted CA where supported).
- GitHub OAuth App at GitHub Developer Settings. **Homepage URL:** `https://YOUR_DOMAIN`. **Authorization callback:** `https://YOUR_DOMAIN/api/v1/auth/callback`. Never point the callback at localhost for hosted mode.
- Two different GitHub accounts for a real cross-account access test. Never save their credentials in the repository or the test suite.
- An alerting provider and an off-host destination for Docker/Caddy logs. Docker log rotation alone does not provide centralized monitoring.

The application intentionally permits only predeclared built-in targets in hosted mode. An in-process queue cannot be safely scaled beyond one app replica. The localhost developer mode is **not** a public configuration.

## 2. One-time configuration

```bash
git clone https://github.com/aakashghartichhetri/echo.git
cd echo
cp .env.production.example .env.production
chmod 600 .env.production
openssl rand -base64 48   # SESSION_SECRET
openssl rand -base64 48   # INTERNAL_ORACLE_SECRET (different value)
```

Fill in the real domain, connection URL, GitHub OAuth client ID/secret, and both separately generated secrets. URL-encode special characters inside a PostgreSQL connection string. Keep `.env.production` outside Git. Protect the server and Docker group; people with access to the Docker socket can generally inspect container environment variables. Prefer a secrets manager for serious hosting rather than long-lived file-based secrets.

Configure the DNS A/AAAA records to point to the server. Caddy must reach the public ACME services to issue and renew TLS certificates. Do not put a second unconfigured reverse proxy in front of this stack; the app trusts exactly one proxy hop. The Compose file publishes only Caddy; port 3001 stays internal.

## 3. Deploy one replica

```bash
# Check the final image and network configuration before opening registration
docker compose --env-file .env.production -f compose.production.yml config --quiet
docker compose --env-file .env.production -f compose.production.yml build
docker compose --env-file .env.production -f compose.production.yml up -d
docker compose --env-file .env.production -f compose.production.yml ps
# This next command runs *from a trusted workstation with Node.js 24+*:
PUBLIC_ORIGIN=https://YOUR_DOMAIN node scripts/verify-deployment.mjs
```

**Do not paste `docker compose config` output into tickets:** it can expose secrets. The read-only verification script checks public HTTPS response headers, API liveness/readiness, anonymous access denial, and the GitHub authorization redirect. It does not use a real GitHub login or prove certificate renewal.

The hosted Dockerfile no longer runs demo seeding. The local Compose override still seeds example reports. Never use `docker compose down -v` on a database containing real information.

## 4. Mandatory human acceptance checks

Perform on a staging deployment **before production registration**, and repeat after security-sensitive changes:

1. **Real OAuth:** In a fresh browser, start GitHub login and complete the callback. Check a secure `__Host-echo-session` cookie, account view, logout, and an expired-session redirect. Test an altered/expired callback `state`. GitHub consent must show your own OAuth application.
2. **Account isolation:** With GitHub user A, create a run and record its UUID. With user B, confirm that listing, retrieving, cancelling, deleting, and comparing A's UUIDs cannot reveal or modify them. Do not share cookies between sessions.
3. **CSRF:** A write without `Origin`/`x-csrf-token` must fail. A write from an unexpected origin must fail. Authorized writes from the real site must still work.
4. **TLS:** Verify a trusted certificate chain, expected hostname, and HTTP→HTTPS redirect. Inspect Caddy renewal logs after issuance; test renewal in a controlled environment. The read-only check requires HSTS and `nosniff` on API responses.
5. **Operations:** Simulate a worker interruption on staging, confirm incomplete runs become `FAILED`, exercise cancellation, run quota, backup and restore, and review CPU/memory under your expected bounded workload.
6. **Recovery:** Restore a database backup into a separate **empty staging** database. Check migration history, account/run counts, dashboard queries, and one new experiment. Measure the restoration time. Never test restoration directly against the source database.

Record each run's date, commit SHA, environment, test account references (not passwords), result, and responsible reviewer. Until these pass, label this build a **release candidate**.

## 5. Backups and restore drills

Install PostgreSQL client tools (`pg_dump`, `pg_restore`) of a compatible major version and Node.js 24+ on your trusted backup machine. Avoid backups stored only on the application host. The included script writes an owner-only, PostgreSQL custom-format backup, validates its archive index, and does not put the connection URL on the process command line.

```bash
# Environment variables are illustrative; obtain URLs from a secrets manager.
export DATABASE_URL='postgresql://user:password@db.example.com:5432/echo?sslmode=require'
export BACKUP_DIR="$HOME/secure-echo-backups"
bash scripts/backup-database.sh
# Upload the encrypted backup off-host using your approved backup/storage process.
# Keep retention, access logs and periodic restore drills.
```

For a **separate empty staging database** with a name containing `staging`, `restore`, or `drill`:

```bash
export ECHO_RESTORE_DATABASE_URL='postgresql://user:password@staging-db.example.com:5432/echo_staging?sslmode=require'
export ECHO_RESTORE_CONFIRM=RESTORE-INTO-STAGING
bash scripts/restore-staging.sh "$HOME/secure-echo-backups/echo-YYYYMMDDTHHMMSSZ-NNNN.dump"
```

The script rejects exact source-server/database matches, but DNS aliases and provider routing can make two different URLs point to the same server. **Check the target in your provider console before restoring.** The script assumes the destination is empty; it intentionally has no `--clean` option. Archive validation and mocked script tests are **not** proof of a real restore. Encrypt backups before off-host transfer and rotate them according to a documented retention policy.

CI additionally executes a PostgreSQL custom-dump and **separate-database restore drill** against its ephemeral test database. This verifies a schema restore in CI, not recovery of a real production dataset.

## 6. Observability, incidents and rollback

- Monitor `GET /api/v1/health/ready`, host CPU/memory/disk, Caddy certificate expiry, PostgreSQL availability, database disk/storage trends, HTTP 5xx rates, and `worker_failure`/`request_error` logs. Set alerts in an external system; none are provisioned automatically.
- Use `docker compose --env-file .env.production -f compose.production.yml logs --tail=100 app caddy` for diagnostics. Avoid sharing OAuth codes, cookies, headers, database URLs, or account data in incident reports.
- Cap resources and logs: the production Compose file sets memory/PID bounds and JSON log rotation. Request-rate protection in the application is in-process and **not** a DDoS defense; put edge protections in front if the threat model requires them.
- Before schema changes, take a backup and identify rollback compatibility. Restore an old container image only when its schema is known to be compatible with the deployed migrations. Prisma migrations are generally forward-only; reverting code does **not** undo a migration.
- To recover from a failed release, stop accepting new traffic, preserve diagnostics, roll back the image with its immutable digest, and verify readiness. Use the staging restore drill for disaster recovery; never run `down -v` to troubleshoot.

**Honest capacity statement:** The queue handles one in-process experiment at a time with bounded requests. Two simultaneously active runs per account is a quota, **not** a two-worker concurrency guarantee. Run `npm run benchmark:core` and capture real end-to-end wall times and load curves before promising throughput or availability targets.

## 7. Release gate summary

- [ ] Current PR passes `npm ci`, npm audit, source check, TypeScript, Vitest, PostgreSQL tests, real CI restore drill, API/frontend build, Docker build and smoke.
- [ ] Staging GitHub OAuth/CSRF and two-account isolation were manually checked.
- [ ] Trusted public HTTPS, redirect and certificate renewal were checked on the real domain.
- [ ] Provider backup was restored into isolated staging and verified.
- [ ] Operational alerts, log retention, secret rotation, incident owner and rollback were rehearsed.
- [ ] Threat model and single-replica limit are accepted before inviting users.

See [architecture](ARCHITECTURE.md) and [threat model](THREAT_MODEL.md) for design boundaries.
