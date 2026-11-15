# Private API monitoring and logs

Production uses [deploy/compose.yaml](../deploy/compose.yaml) and [Caddyfile](../deploy/Caddyfile). The app serves CRM traffic on port 3000 and metrics on a separate port 9464. Neither port is published. `METRICS_HOST` defaults to `127.0.0.1` outside that stack; production binds to its container interfaces so Prometheus can scrape `app:9464` over the internal `monitoring` network. The metrics listener serves only `GET`/`HEAD /metrics` and has no CRM routes. It has no authentication: its network isolation is required.

Prometheus and Grafana share the internal monitoring network plus a separate `monitoring_access` bridge. Docker needs that bridge's gateway to publish loopback ports; it has no API, database, or Caddy members. Monitoring host ports are hardcoded to loopback (`127.0.0.1:9090` and `127.0.0.1:3001`); Caddy has no monitoring-network membership or upstream for either service. Explicit proxy rules return 404 for `/metrics`, `/api/metrics`, `/grafana`, `/prometheus`, `/monitoring`, Prometheus query endpoints, and their configured subpaths. Keep host firewalls restricted to the intended SSH and HTTPS/HTTP ports; never change these bindings to `0.0.0.0` or add a public monitoring proxy.

## Enable on a VPS

Run server commands from the directory containing the contents of `deploy/`, after deploying the app as described in [VPS deployment](vps-deployment.md).

`python3 setup.py --monitoring` adds a missing random Grafana password to the private server `.env`, preserving existing database, session, and valid Grafana secrets.

```sh
python3 setup.py --monitoring
```

`python3 deploy.py monitoring` validates the loopback bindings, private networks, and configured password, then pulls and starts the optional monitoring profile.

```sh
python3 deploy.py monitoring
```

New installations created by `setup.py` already have a random Grafana password. Retrieve `GRAFANA_ADMIN_PASSWORD` privately from the server `.env` using your secure operator workflow; do not paste the file into tickets or CI logs. Grafana uses that password only to initialize a new volume: changing `.env` does not rotate an existing account. Use Grafana's account settings to change an initialized password. No CRM staff credentials are used for monitoring.

`ssh -N -L 9090:127.0.0.1:9090 -L 3001:127.0.0.1:3001 <deploy-user>@<vps-host>` opens authenticated SSH tunnels to both loopback interfaces; replace the account and host.

```sh
ssh -N -L 9090:127.0.0.1:9090 -L 3001:127.0.0.1:3001 <deploy-user>@<vps-host>
```

Open `http://127.0.0.1:3001` locally, sign in as the configured `GRAFANA_ADMIN_USER` (default `admin`), and open **CRM Operations > Minimalist CRM API** (`/d/crm-api`). Prometheus is available through the tunnel at `http://127.0.0.1:9090`; check **Status > Target health** for the `crm-api` target. Local host users can access the loopback monitoring interfaces, so the VPS account boundary must be trusted.

## Metrics and provisioned dashboard

[Prometheus configuration](../deploy/monitoring/prometheus.yml) scrapes every 15 seconds; the named data volume retains 15 days. [Grafana provisioning](../deploy/monitoring/grafana/provisioning/) creates a fixed datasource UID `crm-prometheus` and loads the versioned [dashboard JSON](../deploy/monitoring/grafana/dashboards/crm-api.json). Edit that file in Git to change the dashboard; UI edits are disabled. Monitoring data volumes persist through normal restarts.

| Panel | Meaning | Query |
| --- | --- | --- |
| Request rate | Completed API requests/second, by route | `sum by (route) (rate(crm_api_http_requests_total{job="crm-api"}[5m]))` |
| 5xx error rate | Percentage of requests returning 500–599, by route; zero when requests have no 5xx | Dashboard uses the 5xx counter rate divided by total rate, multiplied by 100, with an explicit zero fallback |
| p95 latency | Estimated 95th percentile API duration in seconds, by route | `histogram_quantile(0.95, sum by (le, route) (rate(crm_api_http_request_duration_seconds_bucket{job="crm-api"}[5m])))` |

The counter labels are `method`, `route`, and `status_code`; histogram labels are `method` and `route`. Routes are bounded templates such as `/api/contacts/:id`, `/api/auth/login`, or `unmatched`. IDs, query strings, customer fields, usernames, IPs, and request IDs never become metric labels. Health/readiness, frontend requests, and monitoring scrapes do not affect API rates. Durations cover authentication through response completion. Histograms include failure responses; p95 is a bucket-based estimate. A new/idle app needs at least two scrapes and some traffic before rate panels show data. Restarts reset in-process counters; `rate` handles resets.

Generate ordinary authenticated list/detail/create/edit traffic using the dashboard or the documented [API requests](api-requests.md). Do not create artificial failures on a production database. The isolated verification command below generates requests and a temporary database outage to prove non-zero error and latency panels.

## Structured logs and request correlation

The API emits one JSON completion record with `time`, `level`, `event`, generated `request_id`, `method`, route template, `status_code`, and `duration_ms`. The same ID is returned in `X-Request-ID`; incoming request IDs are ignored. Error/startup/session-store logs contain a fixed event name and timestamp/level only. Request bodies, raw URLs/queries, headers, cookies/session IDs, credentials, contact details, Prisma errors, and stack traces are excluded. Caddy has no access log and filters the complete request object and error trace from runtime logs, including upstream failures.

`docker compose --env-file .env -f compose.yaml logs --since 10m app` shows the recent structured API events without dumping configuration or record contents.

```sh
docker compose --env-file .env -f compose.yaml logs --since 10m app
```

When reporting a failed request, retain its response request ID, approximate timestamp, and status; avoid copying customer response bodies. Configure host log rotation and retention for the server's capacity and operational policy. Backups and `.env` files must never enter log or metrics storage.

## Verification and hosted checks

`npm run test:production --workspace backend` builds fresh images and tests the actual proxy, API, Prometheus, Grafana, and backup helper with synthetic records in isolated volumes.

```sh
npm run test:production --workspace backend
```

The verifier uses a trusted local Caddy CA, temporary loopback ports, and a two-second scrape interval for speed; the production scrape interval stays 15 seconds. It generates list/detail traffic, checks readiness 503 and API 500 during a disposable PostgreSQL outage, verifies recovery, queries **each provisioned panel through Grafana's datasource API for positive numeric data**, checks private network/port bindings and public 404 responses, and probes logs for sensitive values. It also exercises [backup recovery](backup-restore.md) and deployment rollback, then removes only its own stack/volumes.

A full CRM URL is not configured in this repository. On the hosted environment, still verify public DNS/TLS, public `/health` and `/ready`, the same denied operational paths from an external machine, inability to connect publicly to 9464/9090/3001/5432/3000, SSH tunnel access and authenticated Grafana, target health and all three panels after authorized staging traffic, host firewall rules, log rotation, monitoring retention/disk capacity, and a scheduled off-host backup plus restore drill. Record those results separately from local container verification. These dashboards do not configure alert delivery.
