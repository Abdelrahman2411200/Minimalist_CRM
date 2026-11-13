# Full application containers

The root Dockerfile uses Node 24.14.0 LTS and the committed root npm lockfile. Its build stage compiles the TypeScript API (including the staff provisioning CLI), generates the Prisma client, and builds the **full** React target with root-relative assets. The final `runtime` target contains the compiled API, generated client, full frontend, and production application dependencies. It runs as the unprivileged `node` user. Source files, local environment files, fixtures, tests, Vite, TypeScript, tsx, Playwright, and the Prisma CLI are excluded from that image.

The separate `migrate` target contains the locked Prisma CLI, schema, versioned SQL migrations, and the small configuration module's dependencies. Its deployment tooling manifest and lockfile live in `docker/migrations/`; both Docker dependency stages use `npm ci` with their applicable lockfile. The root lockfile remains shared by the two application workspaces, where Prisma is a development dependency. Keep the migration tooling's Prisma version aligned with the backend's pinned version when upgrading. Optional tool peers are omitted from the runtime image. Containers do not install packages or generate clients at startup. Neither image includes database credentials or session secrets. `.dockerignore` excludes local environment files and generated host output from the build context.

## First startup

Install the recorded Node/npm runtime and run `npm ci` to install the locked tools used by local configuration and verification commands.

```sh
npm ci
```

Create the root `.env` from `.env.example` if it does not exist, using the platform-specific copy commands in the [README](../README.md#local-configuration). Replace the local database password before initializing a new database volume. Existing PostgreSQL volumes retain their original credentials: editing initialization variables does not change an existing database role's password. Host-based development also needs a matching `backend/.env` database URL.

`npm run auth:setup --workspace backend` creates missing root/backend environment files from their templates and configures random session secrets without printing them or replacing existing valid secrets.

```sh
npm run auth:setup --workspace backend
```

Root `.env` supplies `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`, `APP_PORT`, `CRM_ORIGIN`, and `SESSION_SECRET` to Compose. Defaults bind PostgreSQL to `127.0.0.1:5432` and the dashboard to `127.0.0.1:8080`. Set `CRM_ORIGIN` to exactly the browser origin, without a trailing slash, and keep it consistent with `APP_PORT`. Compose passes database credentials as separate server-only values; the API and migration container encode them into a PostgreSQL URL internally, including reserved characters. The session secret is supplied only to the application. No backend environment file is baked into or mounted inside the images.

`docker compose up --build -d --wait app` builds both targets and starts the database, migration job, and application in dependency order.

```sh
docker compose up --build -d --wait app
```

The migration job waits for PostgreSQL's `pg_isready` health check and runs `prisma migrate deploy`. The application starts only after migrations exit successfully. A migration failure blocks application startup. Repeated startup applies only pending migrations and does not reset or seed the database. The runtime health check calls `/ready` with a timeout; it reports unhealthy when the database cannot be reached. `/health` continues to describe process health independently of PostgreSQL.

`docker compose exec app node dist/scripts/provision-user.js` prompts for a chosen staff username and hidden 12–128 character password and writes a salted password hash to PostgreSQL.

```sh
docker compose exec app node dist/scripts/provision-user.js
```

Run this for the first account and repeat it for additional staff. An existing username is rejected, preserving its password. For automation, the same compiled command supports `--username` and `--password-stdin`; stream a password from your secret manager, keeping it out of command arguments and history. There is no self-registration or default staff password.

Open <http://127.0.0.1:8080/#/contacts> and sign in. The dashboard, assets, `/api`, `/health`, and `/ready` share the application origin. Hash navigation allows detail-page reloads without an HTML catch-all route. Missing API routes return JSON 404 responses; missing assets also stay 404. HTML is revalidated, while Vite's fingerprinted assets receive immutable caching. Every CRM record route still requires a session and unsafe requests still require the configured Origin.

Local Compose uses `CRM_NODE_ENV=development` for loopback HTTP, even though the image contains only runtime dependencies. The image itself defaults to production. On an HTTPS server use `CRM_NODE_ENV=production`, `CRM_ORIGIN=https://<crm-domain>`, a private generated secret, and `TRUST_PROXY_HOPS=1` only if exactly one exclusive trusted HTTPS reverse proxy fronts the application. Production requires an HTTPS origin and enables Secure cookies. The HTTPS proxy and hosted deployment workflow are Phase 7 work.

## Readiness and troubleshooting

`docker compose ps -a` shows application/database health and the migration container's exit status; a successful migration job exits with code zero.

```sh
docker compose ps -a
```

`docker compose logs --tail 100 migrate app` shows migration/startup diagnostics without requiring a dump of environment values.

```sh
docker compose logs --tail 100 migrate app
```

`docker compose exec app node --input-type=module -e "const r = await fetch('http://127.0.0.1:3000/ready'); console.log(r.status, await r.text());"` checks readiness inside the container.

```sh
docker compose exec app node --input-type=module -e "const r = await fetch('http://127.0.0.1:3000/ready'); console.log(r.status, await r.text());"
```

Readiness returns 200 and `{"status":"ready"}` when PostgreSQL is reachable, or 503 and `{"status":"unavailable"}` otherwise. If authentication configuration is missing, run the documented `auth:setup` command and recreate the application. If a port is in use, update the root port setting and the corresponding origin or host-based database URL. Avoid sharing resolved Compose configuration or container inspection output that includes environment values.

`docker compose run --rm migrate` applies committed migrations explicitly, for example before recreating the app after an update; it does not seed data.

```sh
docker compose run --rm migrate
```

## Data retention and verification

The `postgres_data` named volume mounts at `/var/lib/postgresql`, the PostgreSQL 18 image's persistent data directory. Keep the same Compose project name and database/session configuration when restarting or recreating services. All staff share those records. Database credentials and the session signing secret must be retained independently of the image.

`docker compose restart postgres app` performs an ordinary restart while preserving records and sessions.

```sh
docker compose restart postgres app
```

`docker compose down` removes containers and the network while retaining the named volume, so a later startup reuses the database.

```sh
docker compose down
```

Do not add `--volumes` to the normal teardown command: that option removes database data. A named volume persists between restarts but is not a backup. Verified backups and recovery are scheduled for Phase 8.

`npm run test:compose --workspace backend` builds both targets and verifies the documented lifecycle with generated credentials and synthetic records in its own randomly named Compose project and new volume.

```sh
npm run test:compose --workspace backend
```

It checks empty-database migration deployment, readiness, static assets, JSON API 404s, unauthenticated rejection, compiled staff provisioning, sign-in, contact/lead/opportunity creation, a field edit, exact money/date values, ordinary restart, and container removal/recreation with the volume retained. Stopping PostgreSQL must produce 503 readiness while process health remains 200; starting it restores readiness. It verifies that the same authenticated session and linked records survive, that repeat migrations have nothing pending, and that the runtime is non-root and excludes environment files and build/test/migration tooling. Cleanup removes only the verifier's test project and volume. It never uses the normal development `postgres_data` volume. Docker must be running; fresh uncached builds need registry access.

GitHub Actions validates both image builds alongside lint, types, frontend builds, migrations, and database/API integration tests. The isolated Compose lifecycle command is also available for local Docker verification. Neither the CI workflow nor these commands publish images or deploy to a hosted service.
