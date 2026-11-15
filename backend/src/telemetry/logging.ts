export type RequestLog = {
  event: 'http_request'; request_id: string; method: string; route: string;
  status_code: number; duration_ms: number;
};
export type SystemEvent = 'api_listening' | 'metrics_listening' | 'startup_failed' | 'listener_failed'
  | 'shutdown' | 'shutdown_failed' | 'unhandled_error' | 'session_pool_error' | 'session_store_error';
export type LogSink = (line: string) => void;
const stdout: LogSink = (line) => { console.log(line); };

// Allowlisted fields only; never serialize a request, response, error, or arbitrary object.
export function logRequest(record: RequestLog, sink: LogSink = stdout) {
  sink(JSON.stringify({ time: new Date().toISOString(), level: record.status_code >= 500 ? 'error' : 'info',
    event: 'http_request', request_id: record.request_id, method: record.method,
    route: record.route, status_code: record.status_code, duration_ms: record.duration_ms }));
}
export function logSystem(event: SystemEvent, level: 'info' | 'error' = 'info') {
  stdout(JSON.stringify({ time: new Date().toISOString(), level, event }));
}
