import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { RequestHandler } from 'express';
import { Counter, Histogram, Registry } from '@prometheus-io/client';
import { logRequest, type LogSink } from './logging.js';

// Bounded templates also cover requests rejected before Express selects a handler.
// New endpoints add their template here; unmatched paths never become metric/log labels.
export function routeTemplate(path: string) {
  if (/^\/api\/auth\/(login|logout|me)\/?$/i.test(path)) return path.toLowerCase().replace(/\/$/, '');
  const resource = /^\/api\/(contacts|leads|opportunities)(?:\/([^/]+))?\/?$/i.exec(path);
  if (resource) return `/api/${resource[1]!.toLowerCase()}${resource[2] ? '/:id' : ''}`;
  if (path === '/health' || path === '/ready') return path;
  if (path === '/' || path.startsWith('/assets/')) return 'frontend';
  return 'unmatched';
}

export function createTelemetry(sink?: LogSink) {
  const registry = new Registry();
  const requests = new Counter({ name: 'crm_api_http_requests_total', help: 'Completed API HTTP requests.',
    labelNames: ['method', 'route', 'status_code'], registers: [registry] });
  const duration = new Histogram({ name: 'crm_api_http_request_duration_seconds', help: 'API server request duration in seconds.',
    labelNames: ['method', 'route'], buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10], registers: [registry] });
  const middleware: RequestHandler = (request, response, next) => {
    const started = performance.now();
    const requestId = randomUUID(); // Ignore caller identifiers which could contain sensitive data.
    const route = routeTemplate(request.path);
    const method = ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'].includes(request.method) ? request.method : 'OTHER';
    const isApi = /^\/api(?:\/|$)/i.test(request.path);
    response.locals.requestId = requestId;
    response.setHeader('X-Request-ID', requestId);
    let recorded = false;
    const complete = () => {
      if (recorded) return;
      recorded = true;
      const seconds = (performance.now() - started) / 1_000;
      const status = response.locals.requestFailed ? 500 : response.writableFinished ? response.statusCode : 499;
      if (isApi) {
        requests.inc({ method, route, status_code: String(status) });
        duration.observe({ method, route }, seconds);
      }
      logRequest({ event: 'http_request', request_id: requestId, method, route, status_code: status,
        duration_ms: Math.round(seconds * 1_000_000) / 1_000 }, sink);
    };
    response.once('finish', complete);
    response.once('close', complete);
    next();
  };
  return { registry, middleware };
}

// Separate listener: no CRM records/auth routes and no collection of its own scrapes.
export function createMetricsServer(registry: Registry) {
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url !== '/metrics' || !['GET', 'HEAD'].includes(request.method ?? '')) {
      response.writeHead(404).end();
      return;
    }
    try {
      response.setHeader('Content-Type', registry.contentType);
      const metrics = await registry.metrics();
      response.writeHead(200).end(request.method === 'HEAD' ? undefined : metrics);
    } catch { response.writeHead(503).end(); }
  });
}
