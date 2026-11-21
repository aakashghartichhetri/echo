# Threat model and security boundaries

Scope: a single-instance hosted SaaS serving built-in, deterministic test interfaces. This document is not a penetration-test certificate. The security-relevant boundaries are browser -> public proxy -> API, API -> PostgreSQL, API worker -> HTTP oracle, and application -> GitHub OAuth.

| Threat | Defense in this change set | Remaining risk |
| --- | --- | --- |
| Forged OAuth callback | Random short-lived state in a `Secure`, `HttpOnly`, `SameSite=Lax` cookie; exact callback-state comparison, validation, timeout, bounded JSON responses | Live GitHub OAuth flow still needs deployment testing; no provider-independent identity system |
| Session theft or CSRF | Random cookie token, SHA-256 database hash, seven-day expiration, session-bound HMAC CSRF token, exact Origin validation on writes | Stolen session cookies remain useful until revoked/expired; no automatic suspicious-login detection |
| Cross-account object access | User ID in report list/detail/compare/delete queries; cancellation carries owner ID; pagination cursor ownership check | A repository-wide audit should accompany any new resource type |
| Job cancellation race | Conditional state transitions; cancellation persisted before abort; late worker result cannot replace `CANCELLED` | One in-memory worker; restart marks unfinished work failed rather than resuming |
| Account deletion race | User row lock shared with enqueue before checking active runs and deleting account | External exports or backups may retain data according to provider policy |
| SSRF from target URL | Public callers never choose URLs; hosted mode blocks external targets. Local operator targets require HTTPS on port 443 by default. Checked DNS answers are pinned to the TCP connection; redirects and private IP ranges are refused. | The IP list cannot replace container/network egress restrictions; DNS/route policy must be reviewed for any future arbitrary-target feature |
| Oversized/hanging response | 16 KiB response cap, five-second timeout, upstream status validation, abort propagation, no automatic POST retry | High request counts still consume worker resources; strict budgets limit the damage |
| Flooding | In-memory per-IP limits with bounded maps; per-user daily, active, storage, and query limits | Single-process limits do not apply across replicas; edge-level protection is needed for a public service |
| Secret leakage | Environment secrets excluded from Git/Docker contexts; worker-secret URL must be loopback; token values aren't logged | Secrets still exist in container environment and host process memory; production secret management is operator responsibility |
| Loss of service/data | DB migrations, health checks, restart recovery | Disaster recovery, automated backups, alerting, and tested restores belong to the hosting operator |

## Outbound request policy

The oracle makes at most one POST per trace and does not follow 3xx responses. A domain's DNS answers are checked before connection, and the chosen address is pinned via the socket lookup callback; no second DNS lookup is allowed during the connect. Private ranges include loopback, link-local cloud metadata addresses, RFC1918, IPv4-mapped IPv6, ULA, and link-local IPv6. HTTPS is required for an operator external target, unless the operator explicitly opts into a loopback-only local test with `ECHO_ALLOW_LOCAL_EXTERNAL=true`; that option is rejected in GitHub-hosted mode.

The configuration flag grants local loopback access, not access to all private networks. Only the built-in internal oracle may carry the worker secret, and its base URL must point to localhost. Full egress firewall rules, cloud metadata restrictions, container isolation, and a third-party security review are still recommended before broad public distribution.

## Release gates

Run the complete installed Vitest suite, PostgreSQL integration tests, GitHub OAuth checks, npm production audit, Docker build, and smoke tests. Then test HTTPS, account isolation using two independent GitHub accounts, backup restoration, deployment rollbacks, and operational alerts on the actual host. Do not claim the platform is universally safe for arbitrary untrusted API URLs.
