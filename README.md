# Minimalist CRM

A lightweight CRM for tracking contacts, qualifying leads, and managing sales opportunities.

**Current checkpoint: Phase 2.** PostgreSQL, the Prisma model and initial migration, repeatable synthetic fixtures, and database readiness checks are implemented alongside the React application shell. Staff sign-in, CRM resource endpoints, dashboard forms, the portfolio demo, full application containers, CI/CD, and monitoring are planned for later phases. Navigation currently shows placeholder screens.

## Runtime and installation

Use **Node.js 24.14.0 LTS** and **npm 11.9.0**, the versions used for this checkpoint. Node 24 is a [supported LTS release line](https://nodejs.org/en/about/previous-releases). The exact Node version is recorded in `.nvmrc` and `.node-version`; package manifests require Node 24.14.0 or newer within major 24, and npm 11.

Install the recorded runtime with your version manager or the [official Node.js archive](https://nodejs.org/dist/v24.14.0/). With an existing nvm installation on macOS/Linux, `nvm install` installs the version from `.nvmrc`, and `nvm use` selects it. With nvm-windows, `nvm install 24.14.0` installs the version and `nvm use 24.14.0` selects it.

Run all commands below from the repository root unless stated otherwise. npm workspaces install both applications using the **single root `package-lock.json`**; keep that lockfile in version control.

`node --version` and `npm --version` show the active runtime and package manager versions.

```sh
node --version
npm --version
```

`npm ci` installs both workspaces and shared development tools from the committed lockfile.

```sh
npm ci
```

Use `npm install` instead when deliberately adding or updating dependencies; commit manifest and root lockfile changes together.

The root manifest overrides the lint tools' transitive `minimatch` to version 11 to address [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249). Review and remove this override when the upstream tools update their dependency ranges.

## Local configuration

Create the local configuration files from the examples. The root file configures Compose and the backend file supplies the required PostgreSQL connection URL. The frontend file is optional when using its defaults. Example credentials are local placeholders. Replace the database password consistently in the root and backend configuration files. Actual `.env` files are ignored by Git.

In PowerShell, each `Copy-Item` command creates the corresponding local environment file; run these only when the destination does not already exist.

```powershell
Copy-Item .env.example .env
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
```

In macOS/Linux shells, each `cp` command creates the corresponding local environment file; run these only when the destination does not already exist.

```sh
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

| Setting | Location | Default | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | `backend/.env` | `development` | `development`, `test`, or `production` |
| `HOST` | `backend/.env` | `127.0.0.1` | Local listener address |
| `PORT` | `backend/.env` | `3000` | Integer port from 1 to 65535 |
| `DATABASE_URL` | `backend/.env` | Required | PostgreSQL URL matching the root Compose settings |
| `TEST_DATABASE_URL` | `backend/.env` | Example points to port `5433` | Test server with permission to create disposable databases |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Root `.env` | Local placeholders from the example | Compose development database settings |
| `POSTGRES_PORT`, `POSTGRES_TEST_PORT` | Root `.env` | `5432`, `5433` | Loopback-only host ports |
| `API_PROXY_TARGET` | `frontend/.env` | `http://127.0.0.1:3000` | Server-side Vite development proxy target |
| `VITE_APP_TITLE` | `frontend/.env` | `Minimalist CRM` | Public dashboard title |
| `VITE_BASE_PATH` | `frontend/.env` | `/` | Asset base with leading and trailing slashes |

The backend validates configuration before binding its listener. When changing the backend address or port, update `API_PROXY_TARGET` to match. When changing database credentials or ports, update the relevant database URLs too. Percent-encode special characters in URL credentials. Restart development servers after editing environment files. `VITE_*` values are public build-time values. Keep credentials and session secrets on the server.

## PostgreSQL and synthetic fixtures

Docker with the Compose plugin is required for the documented database setup. Node applications run on the host during this phase.

`docker compose up -d --wait postgres` starts PostgreSQL 18 and waits for its `pg_isready` health check.

```sh
docker compose up -d --wait postgres
```

`npm run db:migrate --workspace backend` applies the committed SQL migrations to the database selected by `DATABASE_URL`.

```sh
npm run db:migrate --workspace backend
```

`npm run db:seed --workspace backend` explicitly loads three fictional contacts, two leads, and three opportunities.

```sh
npm run db:seed --workspace backend
```

The seed uses reserved `.test` email addresses and stable fixture UUIDs. Repeating it updates those fixtures to their original values and preserves other records. All fixture writes run in one transaction. Seeding requires development or test mode. Staff provisioning arrives in Phase 3.

The `postgres_data` named volume is mounted at `/var/lib/postgresql`, matching PostgreSQL 18's image layout. `docker compose stop postgres` stops the database while retaining its data, and `docker compose down` removes the Compose containers while retaining the named volume. Database initialization settings apply when the volume is first created.

`npm run db:generate --workspace backend` regenerates the ignored Prisma client after schema changes.

```sh
npm run db:generate --workspace backend
```

`npm run db:validate --workspace backend` validates the Prisma schema without requiring a live database.

```sh
npm run db:validate --workspace backend
```

`npm run db:migrate:dev --workspace backend -- --name <change_name>` creates a new versioned migration during development.

```sh
npm run db:migrate:dev --workspace backend -- --name <change_name>
```

Review generated migration SQL and preserve the custom CHECK constraints for score ranges, finite non-negative values, and required text. The money/date wire formats and Phase 3 session table plan are documented in the [API contract](docs/api-contract.md).

## Verify the database

`docker compose --profile test up -d --wait postgres-test` starts a separate test PostgreSQL service with temporary storage on port 5433.

```sh
docker compose --profile test up -d --wait postgres-test
```

`npm run db:verify --workspace backend` uses `TEST_DATABASE_URL` to create a randomly named empty database, apply migrations, run the seed twice, verify constraints and readiness, and drop its own database in cleanup.

```sh
npm run db:verify --workspace backend
```

The test connection needs `CREATEDB` rights. The supplied Compose test role has those rights. The verifier changes only its randomly created database. Coverage includes UUID defaults, all six stages, score bounds, required fields, duplicate leads, foreign keys, money bounds and exact serialization, leap-day dates, users, and session storage. The HTTP checks cover both 200 and 503 readiness responses and process health while a database is unavailable.

`docker compose --profile test stop postgres-test` stops the test service and releases its temporary database storage.

```sh
docker compose --profile test stop postgres-test
```

## Develop locally

`npm run dev` starts both applications with automatic reload and stops the other process if either exits; Ctrl+C stops the development session.

```sh
npm run dev
```

- Dashboard: <http://127.0.0.1:5173/#/contacts>
- API health: <http://127.0.0.1:3000/health>
- Database readiness: <http://127.0.0.1:3000/ready>
- Other shell routes: `#/leads` and `#/opportunities`; hash routes survive reloads.

Vite forwards `/api` requests to the backend without stripping the prefix. `/health` is a direct backend endpoint outside that proxy. Resource routes are not implemented yet and return JSON 404 responses. Development servers bind to loopback by default, and Vite fails if port 5173 is occupied.

`npm run dev --workspace backend` starts just the API, useful when working in separate terminals.

```sh
npm run dev --workspace backend
```

`npm run dev --workspace frontend` starts just the dashboard and its API development proxy.

```sh
npm run dev --workspace frontend
```

## Verify and build

`npm run lint` checks both workspaces with ESLint and treats warnings as failures.

```sh
npm run lint
```

`npm run type-check` generates the Prisma client and checks backend source, database scripts/tests, frontend source, and Vite configuration with TypeScript.

```sh
npm run type-check
```

`npm run build` compiles the API into `backend/dist/` and builds the dashboard into `frontend/dist/`.

```sh
npm run build
```

`npm run start --workspace backend` runs the compiled API after a successful build.

```sh
npm run start --workspace backend
```

In another terminal, `curl.exe` on Windows checks the live health response, which should return HTTP 200 and `{"status":"ok"}`.

```powershell
curl.exe -i http://127.0.0.1:3000/health
```

On macOS/Linux, `curl` performs the same health check.

```sh
curl -i http://127.0.0.1:3000/health
```

`npm run preview --workspace frontend` serves the built dashboard at <http://127.0.0.1:4173/#/contacts> for local inspection.

```sh
npm run preview --workspace frontend
```

The preview server is for local inspection. Serving the frontend and `/api` from Express on the same production HTTPS origin is scheduled for Phase 5. Resource API integration tests arrive with authentication in Phase 3.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `backend/src/app.ts` | Importable `createApp()` factory, `/health`, and JSON 404 handling; no listener side effects |
| `backend/src/server.ts` | Environment loading, validated startup, listener, and shutdown |
| `backend/src/config.ts` | Server environment validation |
| `backend/src/database.ts` | Prisma client and bounded PostgreSQL connection/query timeouts |
| `backend/prisma/` | Schema, versioned SQL migrations, synthetic fixtures, explicit seed |
| `backend/prisma.config.ts` | Prisma CLI configuration and seed command |
| `backend/tests/database.test.ts` | Isolated PostgreSQL verification and readiness checks |
| `compose.yaml` | Persistent local PostgreSQL and temporary test PostgreSQL |
| `docs/api-contract.md` | Money/date formats, relationships, and session storage plan |
| `frontend/src/` | Responsive React shell and hash navigation |
| `frontend/vite.config.ts` | React build, configurable base, and `/api` development proxy |
| `eslint.config.mjs` | Shared TypeScript and React lint rules |
| `package.json`, `package-lock.json` | Workspace commands and reproducible dependencies |

## Planned CRM behavior

1. Add a contact, such as fictional Sara Ahmed, with work email, company, source, and optional notes.
2. Create a linked lead, manually score it from 1 to 10, and move it from Prospecting to Qualification.
3. Add a sales opportunity with an estimated EGP value and expected close date.
4. Follow the lead through Proposal, Negotiation, Closed Won, or Closed Lost.

Staff will search contacts by name, company, or email and combine lead source and lead stage filters. Contact details will show the linked lead and its opportunities. A contact may have zero or one lead; a lead may have multiple opportunities. Stage applies to the lead as a whole. API money uses non-negative decimal strings and date-only fields use `YYYY-MM-DD`.

The API will use feature modules for auth, contacts, leads, and opportunities. PostgreSQL and Prisma will enforce relationships and store staff accounts and server-side sessions. Authenticated resource routes will implement create, list, detail, and update. Delete, self-registration, per-opportunity stages, and tenancy are deferred.

The planned routes are `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, collection `GET`/`POST` and item `GET`/`PATCH` for contacts, leads, and opportunities. `/health` checks the running process and `/ready` checks database connectivity. Staff provisioning arrives with authentication in Phase 3.

## Delivery roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | TypeScript applications, health, scripts, setup | Implemented |
| 2 | PostgreSQL, Prisma schema, migrations, fixtures, readiness | Implemented |
| 3 | Staff sign-in, PostgreSQL sessions, protected API, integration tests | Planned |
| 4 | CRM screens and build-selected HTTP/in-memory data adapters | Planned |
| 5 | Same-origin container, Docker Compose, GitHub Actions CI | Planned |
| 6 | Standalone synthetic GitHub Pages demo | Planned |
| 7 | GHCR images, HTTPS VPS deployment, migrations and rollback | Planned |
| 8 | Private Prometheus/Grafana, logs, verified backups and recovery | Planned |

The full CRM will run at `https://<crm-domain>/` with sign-in and persistent records. The portfolio at `https://<owner>.github.io/<repo>/` will use fictional records in browser memory, reset changes on reload, display a demo label, and work without an API or credentials. Both will use the same screens with build-selected adapters and hash routes. A configured URL will optionally link the demo to the full CRM.

Future checks will include authenticated API integration tests, both frontend variants, and the Docker image. Operations will include private request-rate, 5xx-error, and p95-latency metrics, request IDs without sensitive record data in logs, and backup restores verified against a disposable database. No hosted deployment has been configured or verified in Phase 2.
