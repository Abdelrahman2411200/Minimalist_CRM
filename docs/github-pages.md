# GitHub Pages demo

The public portfolio uses only fictional contacts, leads, and opportunities from `frontend/src/data/fixtures.ts`. Its edits live in browser memory and reset when the page reloads. It opens directly in the dashboard, shows a visible Demo label, and uses no CRM API, staff credentials, cookies, local storage, or PostgreSQL data. The full application remains a separate HTTPS deployment.

## Repository settings and publishing

1. Open the repository's **Settings > Pages**.
2. Under **Build and deployment > Source**, select **GitHub Actions**. The workflow's configure step expects Pages to be enabled with this source.
3. Under **Settings > Environments**, use the `github-pages` environment and allow deployments from `main`. If you add required reviewers, complete that approval before expecting publication.
4. Optionally open **Settings > Secrets and variables > Actions > Variables** and add a repository variable named `FULL_CRM_URL` with the public HTTPS URL of the hosted full CRM, such as `https://<crm-domain>`. Leave it unset until a hosted full app exists. This value is public; it is not a production secret.
5. Push the reviewed changes to `main`. In **Actions > CI**, wait for `verify`, **Build Pages demo**, and **Deploy Pages demo** to succeed in that order.
6. Open the URL attached to the `github-pages` deployment/environment. For this repository the expected URL is `https://abdelrahman2411200.github.io/Minimalist_CRM/`.

For a fork or renamed repository, the workflow derives the base from the repository context: `/<repo>/` for a project site, or `/` when the repository name equals `<owner>.github.io`. GitHub's expression comparison is case insensitive. Asset URLs use that base; navigation stays in the hash, such as `https://<owner>.github.io/<repo>/#/contacts/10000000-0000-4000-8000-000000000001`. No server rewrite or custom HTML 404 fallback is needed.

The optional repository variable is mapped to `VITE_FULL_CRM_URL` only during the demo build. When configured, the banner displays **Open full CRM** as an external link with a new tab and `noopener noreferrer`. An unset or empty variable omits the link. Changing a build-time variable requires another successful build/deployment; it does not modify an already-published artifact.

## CI and artifact isolation

The [CI workflow](../.github/workflows/ci.yml) uses `needs: verify` and a push-to-main condition. `pages-build` runs in a fresh checkout with read-only contents permission, installs the root lockfile using `npm ci --include=dev`, builds the demo variant, and tests that exact directory before uploading it. Its environment has no database connection, session secret, or production credentials. The Pages browser suite itself imports no API runtime or Prisma client.

Only `frontend/dist` is passed to `actions/upload-pages-artifact@v4`. Source files, environment files, database fixtures, migrations, server code, node_modules, screenshots, and test results are outside the uploaded directory. The artifact check allows only the generated HTML and static assets, rejects links and source maps, and checks that the HTTP adapter and server configuration markers are absent. Demo initialization uses reserved `@example.test` addresses, not database seed files or customer exports. The only backend imports used by the demo are pure shared validation schemas/stage definitions.

`pages-deploy` needs the tested build and uses `actions/configure-pages@v5` and `actions/deploy-pages@v4`. Only this job receives `pages: write` and `id-token: write`, and it deploys through the `github-pages` environment. It performs no checkout or build and cannot publish an unverified working directory. Pull requests and failed verification do not deploy. No personal access token or production server secret is required in workflow configuration.

This follows GitHub's [custom Pages workflow guidance](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages). GitHub Pages serves the fictional static demo; the authenticated full app and container image publication remain separate deployment work.

## Local verification under the intended path

`npm ci` installs the two application workspaces using the committed root lockfile.

```sh
npm ci
```

`npm exec --workspace frontend -- playwright install chromium` installs the browser used for artifact verification; Linux hosts may need `--with-deps`, as used in CI.

```sh
npm exec --workspace frontend -- playwright install chromium
```

In PowerShell, these assignments select the intended project base, a production-mode build, and no external full-app link.

```powershell
$env:NODE_ENV = 'production'
$env:VITE_BASE_PATH = '/Minimalist_CRM/'
$env:VITE_FULL_CRM_URL = ''
```

`npm run build:demo --workspace frontend` creates the demo artifact using those public build settings.

```sh
npm run build:demo --workspace frontend
```

`npm run test:pages --workspace frontend` inspects the artifact and serves it at the configured base on an ephemeral loopback port, then checks asset loading, the demo label, optional link, a complete create/edit/qualification/opportunity workflow, combined filters, validation, and a detail-link refresh.

```sh
npm run test:pages --workspace frontend
```

The suite asserts zero CRM API and fetch/XHR requests, no failed responses or uncaught browser errors, no browser persistence, and reset-on-reload behavior. The local server closes after the test. A screenshot is saved under ignored `frontend/test-results/pages-desktop.png`, outside the deployment artifact. To check an owner site locally, set `VITE_BASE_PATH=/`, rebuild, and rerun the same test. To check the configured link, set `VITE_FULL_CRM_URL=https://<crm-domain>` before rebuilding.

On macOS/Linux, the same build and check can be run with per-command environment variables; the first command builds the project-path artifact and the second verifies that artifact at the same base.

```sh
NODE_ENV=production VITE_BASE_PATH=/Minimalist_CRM/ VITE_FULL_CRM_URL= npm run build:demo --workspace frontend
VITE_BASE_PATH=/Minimalist_CRM/ VITE_FULL_CRM_URL= npm run test:pages --workspace frontend
```

## Hosted checks and unavailable-repository fallback

Once the deployment succeeds, assign `PAGES_URL` to the exact public base URL with its trailing slash; the PowerShell command below selects this repository's published site.

```powershell
$env:PAGES_URL = 'https://abdelrahman2411200.github.io/Minimalist_CRM/'
```

`npm run test:pages --workspace frontend` then runs the same browser workflow against that hosted URL instead of starting a local server; the local-file artifact test is skipped because it would not establish what was deployed.

```sh
npm run test:pages --workspace frontend
```

Clear any stale `VITE_FULL_CRM_URL` expectation if it does not match the configured repository variable. Hosted test edits are fictional and confined to the test browser's memory. The browser never follows the full-app link or writes to the full CRM.

If the repository or deployment is unavailable, build and verify locally as above and perform these exact hosted checks when access is restored:

1. Select **Settings > Pages > Source > GitHub Actions**, set the optional public variable, and permit `main` in `github-pages`.
2. Integrate remote changes without discarding them, then push the reviewed commit to `main` and wait for all three CI jobs to succeed.
3. Open the deployment URL, confirm the Demo/reset label and that sign-in is not required, and check that JS/CSS assets return 200 under `/<repo>/` (or `/` for an owner site).
4. Open `#/contacts/10000000-0000-4000-8000-000000000001`, refresh, and confirm Mariam Example and the linked synthetic opportunity still render.
5. Create a fictional contact, qualify its lead, edit score/stage, create and edit an opportunity, combine search/source/stage filters, and follow the contact's sales history. Refresh and confirm newly created demo records disappear.
6. In browser developer tools, keep the Network panel open for the complete workflow and refresh: there must be no `/api` or fetch/XHR requests. Confirm that the optional full-app link is absent when unset, or has the expected external HTTPS destination when configured.
7. Run the hosted `PAGES_URL` test command above and record its result separately from the local artifact result.
