# CRM release and recovery runbook

Use this with [VPS setup](vps-deployment.md), [private monitoring](operations.md), and [backup/restore](backup-restore.md). Server commands run in the dedicated deployment directory. Replace `<crm-domain>`, image references and fingerprints with reviewed values. There is currently no configured hosted full-CRM URL, so local tests and hosted acceptance must be recorded separately.

## Before release

1. Choose a successful `main` CI run and the full commit-SHA runtime/migration image pair it published; record both registry digests. CI checks code, migrations/API workflows, both frontend builds, local HTTPS deployment/rollback, private dashboard data and a synthetic restore. Confirm registry pull access on the target server.
2. Review SQL changes and compatibility with the current app and the rollback image; plan downtime/forward recovery for destructive changes. Preserve server secrets, the stable Compose project name, PostgreSQL/Caddy volumes and private deployment state.
3. Create a pre-release backup, retain archive plus metadata securely off-host, and confirm the latest restore drill. Ensure sufficient disk capacity, then deploy and verify in staging with authorized synthetic records before production.

`python3 deploy.py status` records the current/previous image identities, any pending failure, and the actual current database migration fingerprint without exposing credentials.

```sh
python3 deploy.py status
```

`python3 backup.py backup` creates the pre-release recovery point; use the backup guide for encrypted off-host retention and restore validation.

```sh
python3 backup.py backup
```

## Deploy and verify

`python3 deploy.py deploy --image '<runtime-image:sha-full-commit>' --migration-image '<migration-image:sha-same-commit>'` validates/pulls the reviewed pair, applies migrations before switching the API, and records success only after container and public HTTPS readiness pass.

```sh
python3 deploy.py deploy --image '<runtime-image:sha-full-commit>' --migration-image '<migration-image:sha-same-commit>'
```

`curl --fail --silent --show-error 'https://<crm-domain>/health'` checks the API process and should return HTTP 200 with `{"status":"ok"}` using valid public TLS.

```sh
curl --fail --silent --show-error 'https://<crm-domain>/health'
```

`curl --fail --silent --show-error 'https://<crm-domain>/ready'` checks PostgreSQL reachability and should return HTTP 200 with `{"status":"ready"}`; HTTP 503 means the process cannot currently reach its database.

```sh
curl --fail --silent --show-error 'https://<crm-domain>/ready'
```

`python3 smoke.py --origin 'https://<crm-domain>'` verifies trusted HTTPS, readiness and anonymous record-route rejection; it does not create records.

```sh
python3 smoke.py --origin 'https://<crm-domain>'
```

On **staging**, `python3 smoke.py --origin 'https://<staging-crm-domain>' --allow-synthetic-write` prompts for the authorized test account and verifies login, secure session flags, synthetic contact creation/readback and logout.

```sh
python3 smoke.py --origin 'https://<staging-crm-domain>' --allow-synthetic-write
```

Open the full dashboard, sign in, verify an existing contact's sales history, and on staging complete contact→lead→opportunity→Closed Won plus a field edit and combined filters. Confirm hash deep-link reload and static asset loading. Sign out and verify record access requires sign-in again. The Pages demo must remain independent of the API and use only fictional in-memory data.

Through the private SSH tunnel, check the Prometheus target is up and Grafana request rate, 5xx percentage and p95 panels have current data after authorized staging traffic. From an external machine verify public operational paths return 404 and monitoring/database/API ports cannot be reached directly. Check structured logs by response request ID without copying bodies or credentials. Record commit/digests, migration fingerprint, backup identifier, health/readiness, smoke result and operational checks for that environment.

## Failure and image rollback

A migration failure leaves the previous application running; inspect the sanitized deployment error and private database state before resolving the failed migration. A failed app/startup/readiness candidate is recorded as pending failure. Do not repeatedly reset/reseed, run arbitrary migration repairs, or assume a SQL rollback is safe. Database unavailability requires database recovery first.

`python3 deploy.py status` retrieves the actual fingerprint and recorded rollback target before making a compatibility decision.

```sh
python3 deploy.py status
```

Review every migration applied since the previous image, including any partially failed deployment, against that image's reads and writes. Only when it is compatible, use the **current actual fingerprint** as acknowledgement. Missing/stale acknowledgements are rejected; the controller selects the recorded previous verified image (or last successful image when the candidate failed) and retains the newer database schema.

`python3 deploy.py rollback --schema-compatible-with '<current-actual-schema-fingerprint>'` restores the recorded image pair after explicit schema review and verifies HTTPS readiness without reversing SQL migrations or deleting data.

```sh
python3 deploy.py rollback --schema-compatible-with '<current-actual-schema-fingerprint>'
```

Repeat health/readiness, login, existing sales history, monitoring and smoke checks, and record the result. If schema compatibility cannot be established, choose a forward fix or the separately planned isolated restore/cutover in the backup guide. Never substitute `docker compose down --volumes`, delete the PostgreSQL volume, or downgrade PostgreSQL to roll back an application image.

## Hosted acceptance still required

The local container verifier exercises real Caddy TLS with an explicitly trusted local CA, metrics scraping, all three Grafana queries, restart/rollback and a synthetic backup restore. Public ACME/DNS, host firewall/SSH isolation, live panel data, image deployment/rollback on the VPS, off-host backup encryption/scheduling/retention and recovery time against a retrieved backup remain pending until a server is configured. Update the README and Pages `FULL_CRM_URL` only after the hosted full CRM is verified.
