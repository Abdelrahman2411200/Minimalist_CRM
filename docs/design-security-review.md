# Frontend, Selenium and security review

Review date: **2026-11-16 (Africa/Cairo)**. Scope: this repository's full CRM and fictional demo, desktop Chrome and a 390px mobile viewport, isolated PostgreSQL, HTTP integration tests, source/configuration review and dependency auditing. This is bounded regression and security verification. It cannot establish that no attack or undiscovered defect will ever occur; it is not an independent penetration test or a compliance certification.

## Design delivered

- Public full-app landing page at `#/` and `#/welcome`; the demo continues to enter Contacts directly and offers the introduction at `#/welcome`.
- Responsive workspace navigation, branded sign-in with password visibility control, keyboard-submit global contact search, polished forms/tables/details and a mobile layout.
- `#/overview` uses actual contact/lead/opportunity data, exact decimal EGP totals, lead-stage drill-downs, refresh, recent contacts and expected opportunity close dates. Closed leads are excluded from the open pipeline total.
- Lead table/board switching and stage filters persist in hash-route query parameters. Existing create/edit relationships, omitted-field preservation, manual scoring, six stages, EGP/date contracts and demo reset behavior are retained.

## Findings and disposition

| ID | Severity | Exact finding and reproduction | Resolution/status |
| --- | --- | --- | --- |
| UI-001 | Medium | At 390px, scroll the dashboard and navigate to another screen. Selenium reported `element click intercepted`: the sticky global search header covered a mobile Contacts navigation link. | **Fixed.** Mobile navigation stays below the header, and route changes reset scroll before focusing the content without moving it under the header. The full mobile navigation scenario passes. |
| SEC-001 | Medium, defense in depth | The Express app lacked CSP and anti-framing response headers; Caddy's existing headers did not provide these protections. | **Fixed.** Helmet adds a same-origin CSP, blocks inline scripts/styles and framing, sets MIME-sniffing/referrer protections, and enables HSTS in production. Camera, microphone, location and payment permissions are denied. Tests verify the actual response headers. |
| OPS-001 | Deployment follow-up | Login rate limiting uses in-process memory. Restarting an app resets its counters; multiple app instances would not share a limit. | **Open for production scaling.** Use a shared limiter store and reviewed per-account/IP policies before deploying multiple instances. The current single-instance limiter is regression-tested to return 429. |
| OPS-002 | Deployment follow-up | Correct client-IP rate limiting depends on the trusted proxy chain. The temporary Quick Tunnel adds a relay before Caddy; its default forwarded-header handling needs review before treating those IP limits as production controls. | **Open.** Keep the API private, retain exact proxy trust, and verify trusted client-IP attribution when selecting the permanent ingress. Do not trust arbitrary client-supplied forwarded headers. |
| OPS-003 | Operational follow-up | A Quick Tunnel is temporary test access; no permanent VPS/firewall, off-host backup schedule, centralized alert delivery, or independent penetration test has been verified. | **Open.** Follow the release/backup runbooks and perform a hosted security review before handling real customer data. |

No failing product scenarios remain in the latest local Selenium run. The open items above remain tracked; passing tests do not close them.

## Authentication and authorization checks

| Control | Evidence |
| --- | --- |
| Record access | Collection GET/POST and item GET/PATCH for all three resources reject anonymous and forged-cookie requests with 401. |
| Password handling | Salted scrypt password hashes, constant-time comparison and generic invalid-credential errors; provisioning has no default password or public registration endpoint. Existing integration checks verify hashing and provisioning behavior. |
| Login/session lifecycle | Login regenerates the PostgreSQL session; cookie identity changes from a chosen/old value. Logout destroys stored sessions. Deleted staff accounts cannot continue using existing sessions. Expired-session UI supports signing in again. |
| Cookies and transport | HTTP-only/SameSite=Lax cookies are checked in browser tests. Secure cookies behind production HTTPS are checked in the existing API/container suite; the local Selenium host intentionally uses test-mode HTTP. |
| Unsafe browser requests | Missing/empty, `null`, foreign and lookalike origins cannot create records or log a user out. The exact configured origin remains required. |
| Injection and mass assignment | Prisma queries remain parameterized. SQL-like search text returns literal results without altering data; invalid IDs, nested query inputs and unexpected body fields are rejected. |
| Stored text/XSS | A synthetic `<img ... onerror=...>` contact note is rendered as text and does not execute. CSP disallows inline scripts and foreign script sources. |
| Secrets and error details | Identity responses expose only ID/username. Validation responses do not echo supplied passwords or raw Prisma/stack details. Test credentials are random and remain in memory. Existing telemetry tests cover request-body/cookie/contact redaction. |
| Authorization model | **All provisioned staff share the same CRM records**, as specified. This app does not implement per-user record ownership, tenant separation or admin roles; those must be designed before changing that business requirement. |

## Selenium coverage and automatic reports

`npm run test:selenium --workspace frontend` builds both variants, starts temporary loopback HTTP hosts, migrates a uniquely named test database, creates a random staff credential, runs Chrome through Selenium WebDriver, writes its Markdown result, then drops its own database and closes browser/servers.

```sh
npm run test:selenium --workspace frontend
```

Prerequisites: the recorded Node/npm runtime, `npm ci`, and the test PostgreSQL settings described in the README. `TEST_DATABASE_URL` must point to a **test** server with CREATEDB permission. Selenium Manager locates Chrome and downloads a matching driver when needed, so the first run needs network access; its usage statistics are disabled by the test. No Selenium Grid or paid service is required.

`docker compose --profile test up -d --wait postgres-test` starts the disposable local test PostgreSQL service without changing the ordinary CRM database volume.

```sh
docker compose --profile test up -d --wait postgres-test
```

The generated report is **`frontend/test-results/selenium/report.md`**. Each failing scenario gets a `SEL-###` entry containing its expected behavior, sanitized observed WebDriver error and reproduction command. The process exits nonzero on failure. All scenarios and their results are listed, including failures, instead of claiming unexecuted paths passed. Synthetic desktop/mobile screenshots are saved beside the report. This generated folder is ignored by Git; CI uploads only the Markdown report and synthetic screenshots as the **selenium-verification** artifact for seven days, including failed runs.

The 15 Selenium scenarios cover landing/CTA navigation; sign-in validation, visibility and invalid/valid credentials; missing-parent empty states; contact create/edit/cancel; all six lead stages and score bounds; opportunity money/date validation and create/edit/cancel; name/company/email search with combined filters and empty/clear states; overview values, refresh and links; board/table/stage controls; injected loading/failure/retry; mobile navigation/overflow; deep-link persistence and browser storage; session expiry/logout; direct demo entry; demo sales workflow/reset and fixture deep links.

Coverage complements the existing PostgreSQL/API, Playwright and Pages suites. It does not exhaust every browser, timing combination, malicious payload or possible future feature. Firefox/Safari, assistive-technology review, load testing and an independent penetration test remain separate work.

## Commands and local results

| Command | Purpose/result |
| --- | --- |
| `npm run lint` | Backend/frontend lint passed. |
| `npm run type-check` | Backend/frontend/tooling/test type checks passed. |
| `npm run build` | API and full dashboard built. |
| `npm run build:demo --workspace frontend` | Standalone fictional demo built. |
| `npm run test:selenium --workspace frontend` | 15 scenarios passed after UI-001 was fixed; latest report contains zero failures. |
| `npm test --workspace backend` | 45 checks passed, including seven additional security-suite checks. |
| `npm test --workspace frontend` | 7 checks passed, including exact-cent aggregate totals beyond normal floating-point precision. |
| `npm run test:e2e --workspace frontend` | 10 existing full/demo browser checks passed. |
| `npm audit --omit=dev --audit-level=low` | No reported production dependency vulnerabilities at review time; this is a point-in-time package check. |

The CI workflow also runs the new Selenium suite and retains its report, alongside the existing private monitoring, production HTTPS/session, backup-restore and image rollback checks. Refer to the actual CI run for hosted runner results; local tests alone are not a hosted deployment claim.

Primary references: [Selenium Manager](https://www.selenium.dev/documentation/selenium_manager/), [Express production security guidance](https://expressjs.com/en/advanced/best-practice-security/), [Helmet header configuration](https://helmet.js.org/).
