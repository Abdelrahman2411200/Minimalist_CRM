# Phase 8 verification — 2026-11-15

These are **local results on Windows with Docker Desktop**, using Node.js 24.14.0, npm 11.9.0, Python 3.11, PostgreSQL 18, Caddy 2.11.9, Prometheus 3.16.0 and Grafana 13.3.1. No real customer records or hosted CRM database were used. A full-CRM host/URL is not configured. The existing Pages demo returned HTTP 200 at [the published URL](https://abdelrahman2411200.github.io/Minimalist_CRM/).

## Changed paths

| Paths | Change |
| --- | --- |
| `backend/src/telemetry/`, `backend/src/app.ts`, `backend/src/server.ts`, `backend/src/config.ts` | Separate metrics listener, bounded route labels, allowlisted JSON completion/system events and server-generated response request IDs |
| `backend/src/middleware/errors.ts`, `backend/src/modules/auth/session.ts` | Remove raw exception/session-store diagnostics from logs |
| `backend/package.json`, `package-lock.json`, `backend/.env.example` | Locked official Prometheus client dependency and private listener configuration |
| `deploy/compose.yaml`, `deploy/Caddyfile`, `deploy/.env.example` | Internal scrape network, separate loopback access network, optional persistent monitoring profile and public operational-path denial |
| `deploy/monitoring/` | Prometheus scrape config, Grafana datasource/provider, three-panel dashboard |
| `deploy/setup.py`, `deploy/deploy.py`, `deploy/remote.py` | Private Grafana setup/start validation and remote delivery of operations files |
| `deploy/backup.py`, `deploy/test_backup.py` | Binary-safe custom-format backup, checksum metadata, new-target-only transactional restore and validation tests |
| `backend/tests/telemetry.test.ts`, `backend/scripts/verify-production.ts`, `backend/scripts/verify-operations.ts` | Log/metric privacy, actual panel queries, synthetic outage, backup restore and lifecycle checks |
| `.github/workflows/ci.yml`, `.gitignore`, `.dockerignore` | CI runs operations checks; backup archives excluded from Git/build context |
| `README.md`, `docs/operations.md`, `docs/backup-restore.md`, `docs/release-runbook.md`, `docs/vps-deployment.md`, `docs/containers.md`, this report | Setup, commands, recovery/release procedures, actual demo URL, walkthrough and hosted limitations |

Unrelated `.vscode/` and `and.java` files were left untouched. Actual `.env` files and credentials are not part of the change.

## Commands actually run

| Command | Purpose and local result |
| --- | --- |
| `npm install @prometheus-io/client@0.16.1 --workspace backend` | Installed the maintained Prometheus client and updated the root lockfile. |
| `npm ci` | Reinstalled the locked workspaces successfully; npm audit reported 0 vulnerabilities. |
| `npm run lint` | Both workspace lint checks passed. |
| `npm run type-check` | API, tooling/tests and frontend type checks passed. |
| `npm run build` | Compiled the API and built the full frontend. |
| `npm run build:demo --workspace frontend` | Built the standalone demo frontend. |
| `npm test --workspace backend` | 38 checks passed, including isolated migrations/seed, database constraints, auth/resource HTTP flows, static frontend and telemetry. |
| `npm test --workspace frontend` | 6 adapter/workflow checks passed. |
| `npm exec --workspace backend -- tsx --test tests/telemetry.test.ts` | 3 focused privacy/interface/template checks passed, including case-insensitive route normalization. |
| `python -m unittest discover -s deploy -p 'test_*.py' -v` | 14 deployment/backup/configuration checks passed. |
| `npm run test:production --workspace backend` | Built both Docker targets, then tested the actual production controller, private monitoring and PostgreSQL recovery in disposable stacks. The successful rerun supplied `CRM_TEST_IMAGE`/`CRM_TEST_MIGRATION_IMAGE` to reuse the locally built pair with the final API code. |
| `git -c core.safecrlf=false diff --check` | No whitespace errors under the repository's normal line-ending configuration. |
| `curl.exe --fail --silent --show-error --output NUL --write-out 'Pages HTTP %{http_code}\n' https://abdelrahman2411200.github.io/Minimalist_CRM/` | The existing published demo returned HTTP 200; this was an availability check, not a new hosted browser workflow. |

The production verifier invokes Docker builds/Compose and the real Python deployment, smoke and backup helpers. It checks HTTPS with an explicitly trusted local Caddy CA; certificate verification remains enabled. The images are local working-tree test builds, not a claim of a new published release or remote CI result.

## Monitoring and privacy result

Prometheus scraped the private `app:9464/metrics` target successfully. Synthetic authenticated collection/detail requests populated request rate and latency. Four deliberately spaced failures during an isolated PostgreSQL outage produced a positive 5xx rate; readiness returned 503, then recovered to 200 with the existing session intact.

The verifier retrieved the provisioned `crm-api` dashboard through authenticated Grafana APIs and executed each panel's actual Prometheus expression through `/api/ds/query`. **Request rate, 5xx error rate and p95 latency all returned positive finite numeric data.** Tests also verified route templates, no raw ID/query labels, generated/correlated request IDs, and absence of private password/cookie/contact/query probes from API JSON logs. Public operational paths returned 404. API/database ports were unpublished; monitoring ports actually published only on `127.0.0.1`; Caddy did not join monitoring networks.

The first container check exposed Docker 29's refusal to publish ports for services on exclusively internal networks; the separate monitoring-access bridge fixed this while preserving the internal API scrape network. Failure samples were spaced across scrapes to give new counter series a measurable rate. The final complete lifecycle check passed and removed its own containers, networks, volumes and temporary archive. The ordinary local CRM and database remained healthy.

## Backup and recovery result

The real helper created a PostgreSQL custom archive plus SHA-256/migration-history metadata and restored into a **new disposable database**. Restored counts: **1 contact, 1 Closed Won lead scored 8, 1 opportunity, 1 user, 0 sessions**. The source had an active session, confirming deliberate session exclusion. Contact identity/email and linked relationships matched; value `123456.78` and date `2028-02-29` round-tripped exactly. Restored score bounds, non-negative value and foreign-key constraints rejected invalid updates. Applied migration history matched the backup metadata. Attempts to restore into the source or existing restore target were rejected.

The same successful run verified ordinary restart persistence, idempotent deployment, an additive migration, reviewed previous-image rollback without down migrations, migration failure before switching, and recovery from failed app startup.

## Hosted verification still pending

CI now includes these checks, but no new remote CI run, image publication or VPS deployment is claimed here. Configure a real host/DNS/origin and authorized staging account, then follow the [release runbook](release-runbook.md). Verify public ACME TLS, firewall isolation from an external machine, operational-path 404s, SSH tunnel/Grafana authentication and live panel data, host log rotation/capacity, restart/rollback, encrypted off-host backup scheduling/retention, and recovery from a retrieved backup with measured RPO/RTO. Update the README/Pages `FULL_CRM_URL` only once that hosted CRM is verified.
