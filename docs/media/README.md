# Portfolio media evidence

Captured **2026-11-16, Africa/Cairo**, from application release `c1b185b`. These assets are actual screen recordings/screenshots. Application source, CI workflows, dashboard provisioning and security settings were not changed to produce them.

| Asset | Format and source |
| --- | --- |
| [crm-walkthrough.mp4](crm-walkthrough.mp4) | 52.67-second H.264 MP4, 1280×960, 12 fps, no audio, about 458 KiB. Recorded from the live [GitHub Pages demo](https://abdelrahman2411200.github.io/Minimalist_CRM/). |
| [crm-walkthrough-thumbnail.png](crm-walkthrough-thumbnail.png) | Actual frame of the completed fictional opportunity, with a clearly separate play/format annotation; links to the MP4 in the main README. |
| [grafana-local-synthetic.png](grafana-local-synthetic.png) | Actual 1440×1120 Grafana dashboard screenshot from the existing local Docker staging stack. Label: **Local monitoring with synthetic traffic**. |

## Walkthrough

The continuous recording shows fictional Sara Example at Fictional Cedar Studio (`sara@example.test`). It creates the contact, qualifies a linked lead with manual score 8, opens the board, chooses **Edit lead** on the Prospecting card, changes Stage to Qualification, saves, and returns to the board to show the moved card. It then creates a linked fictional website opportunity worth `25000.00` EGP with close date `2028-02-29`, and returns to contact details to show the linked history.

Captions were added only to the recording browser session. Board movement uses the existing edit form, not a simulated drag-and-drop feature. The capture context made **zero CRM API requests and held zero cookies**. It contained only synthetic demo fixtures and the fictional record created for this walkthrough. Edits disappear on reload. MP4 plus a clickable thumbnail was selected instead of a roughly 9 MB GIF to keep the README media small and text readable.

## Monitoring workload

The existing local staging app, PostgreSQL, Prometheus and Grafana were confirmed running; no real customer database was used. A temporary staff account authenticated through the loopback staging reverse proxy with the configured exact HTTPS origin. Credentials/session values stayed in memory and private local configuration. No authentication screen or credential entry was recorded.

The workload created a clearly fictional contact, linked lead and opportunity, changed the lead to Qualification, then distributed reads across contact/lead/opportunity collection and detail routes. It logged out afterward. **186 requests** completed: 182 HTTP 200, 3 HTTP 201 and 1 HTTP 204, over approximately 92 seconds. No outages or artificial server failures were induced.

Grafana's actual datasource query endpoint returned finite numeric samples for all three provisioned panels: request rate, 5xx error percentage and p95 API processing latency. The 5xx maximum during the capture window was **0%**. Latency is a per-route histogram estimate in seconds/milliseconds, not browser-to-Cloudflare round-trip time. Dashboard labels contain route templates, not contact fields, identifiers, raw query strings, passwords or cookies. The image shows a local snapshot; it is not a live embedded chart or a hosted VPS result. Monitoring endpoints remain private.

## CI evidence

[Main CI run #43768278775](https://github.com/Abdelrahman2411200/Minimalist_CRM/actions/runs/43768278775) completed successfully for `c1b185bba5a173005b30b9ba54c5d2ed99321e33`. Its verify job passed lint, type checks, both frontend variants/API builds, Prisma migrations, database/API/security tests, demo adapter tests, Selenium desktop/mobile scenarios, both Docker image builds, deployment validation, and the HTTPS/session/restart/rollback/private-monitoring/backup-restore checks. Its image publication, Pages artifact/browser verification and Pages deployment jobs also succeeded.

This run identifies the application release shown in the assets. Subsequent documentation/media-only commits do not change that application code. Public DNS/TLS and deployment on a permanent VPS, off-host backup scheduling and a hosted recovery drill remain pending as described in the release runbook.
