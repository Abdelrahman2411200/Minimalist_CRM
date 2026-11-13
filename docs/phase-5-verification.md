# Phase 5 local verification

Verified locally on 2026-11-13 on Windows with Node 24.14.0, npm 11.9.0, Docker Engine 29.7.2, and Docker Compose 5.4.0. These are local results; no images were published and no hosted GitHub Actions run or HTTPS deployment was performed.

| Commands actually run | Result |
| --- | --- |
| `npm ci` | Locked application dependencies installed; audit reported zero vulnerabilities |
| `npm install --package-lock-only --ignore-scripts --prefix docker/migrations` | Created the dedicated migration tooling lockfile; its dependencies were subsequently installed with `npm ci` inside Docker |
| `npm run auth:setup --workspace backend` | Configured the ignored root Compose secret, preserving existing valid local secrets |
| `npm run lint` | Both workspaces passed with no warnings |
| `npm run type-check` | Both workspaces, backend tools/tests, and frontend tests passed |
| `npm run build` | API compilation and full frontend build passed |
| `npm run build:demo --workspace frontend` | Standalone demo build passed |
| `npm test --workspace backend` | 35 checks passed, including isolated migrations, seed, constraints, auth/API flows, static serving, and JSON 404s |
| `npm test --workspace frontend` | 6 adapter/formatting checks passed |
| `npm run test:e2e --workspace frontend` | 10 Chromium checks passed for both targets; full-mode tests use Express's frontend-serving implementation |
| `npm exec -- eslint docker/prisma.config.mjs` | Container migration configuration passed lint |
| `docker run --rm --mount "type=bind,source=$PWD,target=/repo,readonly" --workdir /repo rhysd/actionlint:latest -color .github/workflows/ci.yml` | Workflow validated with actionlint 1.7.12 |
| `docker compose config --quiet` | Compose configuration validated without displaying secret values |
| `npm run test:compose --workspace backend` | Both Docker targets built; the complete isolated lifecycle verification passed |
| `docker compose up --build -d --wait app` | Normal local stack started successfully; migration job exited zero, application and PostgreSQL were healthy |

The Compose verifier created a fresh PostgreSQL named volume in its own randomly named project. It applied the versioned migration, provisioned synthetic staff using the compiled CLI and stdin, served the full frontend and its asset from Express, rejected anonymous record requests, and preserved JSON 404 responses. It created and edited a contact with a lead and opportunity and checked exact `123456.78` money and `2028-02-29` date values.

Stopping its PostgreSQL service returned 503 from `/ready` while `/health` remained 200. The same session and linked records survived an ordinary restart of PostgreSQL and the app, then a Compose teardown without volume removal followed by startup. Repeat migration deployment reported no pending migrations. The verifier confirmed a non-root runtime without `.env` files, TypeScript, tsx, Vite, Playwright, or the Prisma CLI, then removed only its own project and test volume.

Initial uncached attempts encountered a package download timeout and local Docker memory pressure. The final implementation separates migration dependencies, caches package downloads outside image layers, bounds installer heap memory, and passed the subsequent full verification. Both development PostgreSQL services were restored and healthy afterward.

Final loopback checks at `http://127.0.0.1:8080` returned:

| Path | Status | Response type |
| --- | --- | --- |
| `/` | 200 | HTML |
| `/health` | 200 | JSON |
| `/ready` | 200 | JSON |
| `/api/missing` | 404 | JSON |
| `/api/contacts` without a session | 401 | JSON |

Changed paths are `Dockerfile`, `.dockerignore`, `compose.yaml`, `.github/workflows/ci.yml`, `docker/prisma.config.mjs`, `docker/migrations/package.json`, `docker/migrations/package-lock.json`, `.env.example`, `backend/.env.example`, `backend/package.json`, `backend/src/{app,config,server}.ts`, `backend/src/scripts/provision-user.ts`, `backend/scripts/{provision-user,setup-auth,verify-compose}.ts`, `backend/tests/{api,database,frontend}.test.ts`, `frontend/tests/browser.test.ts`, `README.md`, and the container/verification documentation in `docs/`.

The application workspaces still share the unchanged root lockfile. The new deployment tooling lockfile is versioned separately. Actual environment files remain ignored. First-account provisioning requires the user's chosen credentials; run the documented interactive container command if an account is not already provisioned. Hosted CI results require a push to GitHub, and HTTPS deployment remains Phase 7.
