# Full CRM releases and VPS deployment

Phase 7 publishes tested full-app and migration images and supplies a Linux VPS reference. A real hostname, server, and authorized staging account must be configured before a hosted full-CRM deployment can be verified. The existing GitHub Pages site remains a fictional, browser-memory demo.

## Release artifacts

On pull requests and pushes to `main`, [CI](../.github/workflows/ci.yml) builds the full runtime and migration targets, labels both with the complete source commit, and tests production deployment with isolated PostgreSQL/Caddy volumes and trusted local HTTPS. The runtime contains the full React build and compiled API; the migration CLI remains in a separate image.

After all verification succeeds on `main`, CI exports those exact image identities to the short-lived `crm-release-images` artifact. The publish job downloads that artifact from the same run, verifies its image IDs and commit labels, then tags and pushes it without rebuilding:

- `ghcr.io/<owner>/<repo>-app:sha-<full-40-character-commit-sha>`
- `ghcr.io/<owner>/<repo>-migrate:sha-<same-commit-sha>`

Registry paths are lowercase. For this repository they are `ghcr.io/abdelrahman2411200/minimalist_crm-app` and `ghcr.io/abdelrahman2411200/minimalist_crm-migrate`. The workflow summary includes tags and registry digests. Prefer retaining the digest alongside the SHA tag when recording a release. The publisher alone receives `packages: write`; it authenticates with the scoped `GITHUB_TOKEN`, supplied through stdin, and logs out afterward. Pull requests never publish. Release archives expire after one day; successful registry images remain available independently of that archive.

GHCR package visibility is controlled in the package settings. Public packages can be pulled anonymously; private packages require an authorized read credential on the VPS. See GitHub's [Container registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry). Production database credentials and session secrets are never build inputs, image layers, release artifacts, or frontend values.

## Server prerequisites and reference topology

Use a Linux x86-64 VPS with Docker Engine, Docker Compose v2 or newer, Python 3.11 or newer (standard library only), outbound registry/ACME access, and enough disk for PostgreSQL, Caddy certificates, and at least the current and previous image pairs. The published runner images target Linux amd64; other architectures require separately built and tested images.

Prepare a dedicated deployment account with Docker access and ownership of a dedicated directory, such as `/opt/minimalist-crm`. Docker access grants host administration privileges, so this account is trusted deployment infrastructure. Put the **contents** of the repository's `deploy/` directory there. The commands in the following server sections run from that directory, where `compose.yaml`, `Caddyfile`, and `deploy.py` sit together.

Configure a DNS A record for `<crm-domain>` pointing to the VPS, allow inbound TCP 80/443, and retain SSH access for the deployment account. Add an AAAA record only when IPv6 proxy binding and firewall access have also been configured. Ports 3000 and 5432 must not be published. Caddy obtains and renews public HTTPS certificates and redirects HTTP to HTTPS; retain its `caddy_data` volume. See [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https).

The [production Compose file](../deploy/compose.yaml) deliberately differs from local development:

| Network | Members | Access |
| --- | --- | --- |
| `edge` | Caddy only | Public network for ports 80/443 and certificate issuance |
| `frontend` | Caddy and app | Internal/private network; proxy reaches app port 3000 |
| `database` | App, migration tool, PostgreSQL | Internal/private network; no published database port |

The API always uses `NODE_ENV=production`, `TRUST_PROXY_HOPS=1`, the exact HTTPS `CRM_ORIGIN`, and Secure/HTTP-only/SameSite session cookies. Caddy supplies trusted forwarded headers; the app is reachable only through private networks. Caddy's administration API is disabled and access logs are not enabled, so contact searches and session material are not collected in proxy URL logs. PostgreSQL uses a named volume; Caddy certificate/config storage also uses named volumes.

## Configure and deploy the first release

`python3 setup.py` prompts for public hostname, origin, certificate email, and the two published image references, then creates `.env` with random database/session secrets and private permissions without displaying those values.

```sh
python3 setup.py
```

The generator refuses to replace an existing file. Existing PostgreSQL volumes retain their original role password; editing initialization settings does not rotate an existing database credential. Keep the same database password and session signing secret across restarts. Custom credentials can be supplied by editing the server-only `.env` before first initialization, or through a server secret-management process. Do not copy the local development `.env` into production.

| Setting | Meaning |
| --- | --- |
| `COMPOSE_PROJECT_NAME` | Stable project name controlling networks and persistent volume names |
| `CRM_HOST` | Lowercase DNS hostname, without scheme or path |
| `CRM_ORIGIN` | Exact HTTPS browser origin without trailing slash; normally `https://<crm-domain>` |
| `ACME_EMAIL` | Certificate contact email |
| `CRM_IMAGE`, `CRM_MIGRATION_IMAGE` | Matching full-SHA tags or immutable registry digest references |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Server database settings; generated password is random |
| `SESSION_SECRET` | Random signing secret, retained with the database |
| `PROXY_BIND`, `HTTP_PORT`, `HTTPS_PORT` | Proxy host bindings; defaults `0.0.0.0`, `80`, `443` |
| `CADDY_IMAGE`, `POSTGRES_IMAGE` | Reviewed proxy/database images; defaults Caddy 2.11.9 and PostgreSQL 18 |

`docker login ghcr.io` prompts for registry credentials when private package access is needed; use a read-only packages token or a credential helper, keeping the token out of command arguments and source control.

```sh
docker login ghcr.io
```

For a mirrored/private registry, use its hostname with the same login flow and configure both full image references accordingly. The optional GitHub job also supports configurable registry host and repository names. Keep Docker's credential configuration private to the deployment account.

`python3 deploy.py deploy` pulls the configured target pair and infrastructure images, validates matching commit labels and existing migration checksums, starts healthy PostgreSQL, runs production migrations once, and then starts the target app and proxy.

```sh
python3 deploy.py deploy
```

The controller blocks concurrent releases with an operating-system lock. A failed pull or migration leaves the old application unswitched. Migration failures require inspection/resolution; the controller never resets or seeds PostgreSQL. A failed app startup or HTTPS readiness check is recorded in `.deployment-state.json` and is not automatically reverted, because the applied schema may require a compatibility decision.

After the app's container health check succeeds, the controller checks public `https://<crm-domain>/ready`, requiring valid certificate trust/hostname verification, HTTP 200, and exactly `{"status":"ready"}`. Redirects do not count as readiness. Only a ready release updates `.env` image references and the private current/previous release state. The state records image IDs, available registry digests, source commit, and a fingerprint of the applied migration names/checksums. Retain this state alongside the server configuration.

`docker compose --env-file .env -f compose.yaml exec app node dist/scripts/provision-user.js` prompts for the first staff username and hidden password using the compiled provisioning command inside the private app container.

```sh
docker compose --env-file .env -f compose.yaml exec app node dist/scripts/provision-user.js
```

Provision a separate authorized staff account in the **staging/test** instance for deployment smoke checks. All staff on one instance share its records. No default staff credentials or registration endpoint are introduced.

`python3 smoke.py --origin https://<crm-domain> --allow-synthetic-write` checks trusted HTTPS, rejects anonymous record access, prompts for authorized test credentials, verifies Secure/HTTP-only/SameSite session flags, creates and reads back a clearly synthetic contact, and logs out; replace the domain and use it only on the test instance.

```sh
python3 smoke.py --origin 'https://<crm-domain>' --allow-synthetic-write
```

The optional credential inputs are `CRM_SMOKE_USERNAME` and `CRM_SMOKE_PASSWORD` in process environment/CI secrets. Passwords are never command arguments or printed responses. The synthetic record uses an `@example.test` email and a deployment-test source/note. Its ID is reported so staff can identify it later; delete remains deferred. Without `--allow-synthetic-write`, the command checks TLS, readiness, and anonymous rejection only.

## Deploy another version and restart

These two shell prompts capture the published runtime and matching migration references for the reviewed next release; image references contain no account passwords.

```sh
read -r -p 'Reviewed runtime image: ' CRM_TARGET_IMAGE
read -r -p 'Matching migration image: ' CRM_TARGET_MIGRATION_IMAGE
```

`python3 deploy.py deploy --image "$CRM_TARGET_IMAGE" --migration-image "$CRM_TARGET_MIGRATION_IMAGE"` pulls and deploys that target, preserving the previous verified release for rollback.

```sh
python3 deploy.py deploy --image "$CRM_TARGET_IMAGE" --migration-image "$CRM_TARGET_MIGRATION_IMAGE"
```

Use the controller for releases: a raw Compose `up` bypasses the migration/readiness gates. The `migrate` service is a tools profile and is not an application startup dependency, so normal app/database/proxy restarts do not rerun migrations. Repeating a deployment runs `migrate deploy` once again, applying only pending SQL and preserving the previous version even when the current release is redeployed unchanged.

`docker compose --env-file .env -f compose.yaml restart postgres app proxy` performs an ordinary restart while retaining database records, sessions, and certificates.

```sh
docker compose --env-file .env -f compose.yaml restart postgres app proxy
```

`python3 smoke.py --origin https://<crm-domain>` checks HTTPS readiness and anonymous API protection after that restart; replace the domain with the configured origin.

```sh
python3 smoke.py --origin 'https://<crm-domain>'
```

Keep the Compose project name and named volumes. Normal `docker compose down` retains volumes; `down --volumes` destroys them and is reserved for disposable test stacks. PostgreSQL/Caddy image upgrades are separate reviewed infrastructure changes, not a way to roll back the app.

## Roll back only with schema compatibility

An app rollback does **not** reverse a SQL migration or restore database contents. Before redeploying an older image, review every intervening migration against that version's Prisma model, SQL queries, validation, and writes. Keep old columns, enum values, defaults, and required relationships compatible throughout the rollback window. Prefer additive/expand-then-contract migrations. Do not roll back across incompatible drops, renames, type changes, or constraints; use a forward fix or a separately planned restore from a verified backup. Backup/restore automation is Phase 8 work.

`python3 deploy.py status` prints the recorded current/previous images, any pending failed deployment, and the **actual current database** schema fingerprint without exposing credentials.

```sh
python3 deploy.py status
```

After completing the compatibility review, this prompt captures that exact current fingerprint as the operator's acknowledgement.

```sh
read -r -p 'Reviewed current schema fingerprint: ' CRM_SCHEMA_FINGERPRINT
```

`python3 deploy.py rollback --schema-compatible-with "$CRM_SCHEMA_FINGERPRINT"` pulls and redeploys the previous verified image pair, checks that its image content matches the recorded IDs and its migration history is an unchanged prefix of the applied history, and verifies HTTPS readiness without running migrations.

```sh
python3 deploy.py rollback --schema-compatible-with "$CRM_SCHEMA_FINGERPRINT"
```

If a candidate failed after migration/startup, rollback selects the last verified current image instead. The acknowledgement must match the current schema; an old fingerprint is rejected. The prefix/checksum checks protect migration history but cannot prove all application semantics, so the explicit compatibility review remains required. Rollback requires the existing database to be running and never downgrades PostgreSQL or the applied schema. It prefers recorded immutable registry digests when available and verifies image IDs; retain those versions in registry cleanup policies. `--no-pull` is available only for reviewed offline recovery with already-loaded images and for isolated tests; ordinary deployments pull by default.

The fingerprint hashes applied migration names/checksums, not a complete database catalog or customer records. Include any unversioned schema edits in the compatibility review. After a rollback that retains newer migrations, subsequent forward releases must still contain that full applied history; normal restarts keep the reviewed older app without invoking its older migration manifest.

## Optional GitHub VPS deployment job

The manual [Deploy VPS workflow](../.github/workflows/deploy-vps.yml) uses only `main` and the selected protected `staging` or `production` environment. It never runs automatically on a push. Configure each environment with allowed deployment branch `main`, required reviewers if appropriate, and these values:

| Environment variables | Purpose |
| --- | --- |
| `VPS_HOST`, `VPS_USER`, `VPS_PATH` | SSH host/account and dedicated absolute server directory containing the private `.env` |
| `VPS_PORT` | SSH port; defaults to 22 |
| `CRM_ORIGIN` | Expected public HTTPS origin; must match the server configuration |
| `IMAGE_REPOSITORY`, `MIGRATION_IMAGE_REPOSITORY` | Optional registry paths; default to the current repository's GHCR paths |
| `REGISTRY_HOST` | Optional registry login host; defaults to the runtime image registry |

| Environment secrets | Purpose |
| --- | --- |
| `VPS_SSH_PRIVATE_KEY` | Deployment account's SSH private key |
| `VPS_KNOWN_HOSTS` | Verified known_hosts line(s), obtained/checked against the VPS console or another trusted channel |
| `REGISTRY_USERNAME`, `REGISTRY_READ_TOKEN` | Optional read-only registry login for private packages; omit if server credentials/public access are already configured |
| `CRM_SMOKE_USERNAME`, `CRM_SMOKE_PASSWORD` | Pre-provisioned authorized **staging** test account |

Database passwords and session secrets stay in the VPS `.env`, not GitHub variables or frontend configuration. The job uses strict SSH host-key checking, uploads only reviewed deployment tooling/configuration templates, preserves the actual server `.env`, streams registry tokens through stdin, pulls the requested full-SHA release, and verifies public HTTPS. Staging requires the test account and performs synthetic create/readback verification; production performs TLS/readiness/anonymous-access checks without synthetic writes. The first staging setup/provisioning therefore uses the manual server steps above before dispatching this job.

In **Actions > Deploy VPS > Run workflow**, select `main`, the protected environment, and the full SHA from a successful published release. The server and GitHub expected origins must agree. Once the full CRM is hosted and verified, the separate Pages repository variable `FULL_CRM_URL` may be set to its public URL; that is the only public connection from the demo to the hosted app.

## Local validation and pending hosted checks

`python -m unittest discover -s deploy -p test_deploy.py -v` checks pinned image references, origins, SQL-history compatibility, schema acknowledgement binding, exclusive deployment locks, and safe first-time/server configuration updates using temporary files.

```sh
python -m unittest discover -s deploy -p test_deploy.py -v
```

`npm run test:production --workspace backend` builds the image pair when not supplied by CI, then invokes the real deployment controller with isolated volumes and an explicitly trusted local Caddy CA.

```sh
npm run test:production --workspace backend
```

The verifier checks private networks/no app or database host ports, trusted HTTPS, cookie flags and forwarded headers, authorized sign-in, synthetic create/readback, migration reapplication, app/database/proxy restart persistence, an additive schema upgrade, previous-image rollback retaining the newer schema, rejection of missing/stale compatibility acknowledgements, a failed migration before app switching, and failed-startup recovery. Derived synthetic candidate images/migrations are used only in that test stack and are not published. It removes only its own randomly named stack and volumes. Python defaults to `python` on Windows and `python3` elsewhere; override with the task-specific `CRM_DEPLOY_PYTHON` if needed.

When no VPS is configured, the remaining hosted prerequisites/checks are exactly:

1. Supply the Linux host, deployment account/directory, DNS A record, firewall access, and verified SSH host key.
2. Configure private GHCR pull access if required and choose the matching published image references/digests.
3. Create and retain the VPS `.env`, generated database/session secrets, stable project name, and persistent volumes.
4. Run the production controller on that host, confirm successful production migration and public `/ready`, validate the public certificate chain/hostname, and verify HTTP-to-HTTPS redirection.
5. Provision an authorized staging staff account and perform the HTTPS login plus synthetic contact create/readback check on that test host.
6. Configure protected GitHub deployment environments/secrets if using the optional job, dispatch it, and record its hosted result separately from local HTTPS tests.
7. Verify records/session persistence after a real VPS restart, retain a tested database backup, and review schema compatibility before exercising any hosted rollback.

Local CA verification proves the reference container/proxy/session flow; public DNS, ACME issuance, SSH access, and a real staging endpoint remain unverified until those host settings exist.
