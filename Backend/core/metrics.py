from prometheus_client import Counter, Histogram, Gauge, Info, generate_latest, REGISTRY
from flask import Response
import time

http_requests_total = Counter(
    'http_requests_total', 'Total HTTP requests',
    ['method', 'path', 'status'],
)

http_request_duration_seconds = Histogram(
    'http_request_duration_seconds', 'HTTP request duration in seconds',
    ['method', 'path'],
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
)

db_connections_active = Gauge(
    'db_connections_active', 'Active DB connections',
)

data_service_errors_total = Counter(
    'data_service_errors_total', 'Total DataService errors',
)

background_tasks_running = Gauge(
    'background_tasks_running', 'Background tasks currently running',
)

app_info = Info('app', 'Application info')
app_info.info({'version': '0.1.0', 'name': 'gofund-backend'})


def metrics_endpoint():
    return Response(generate_latest(REGISTRY), mimetype='text/plain; version=0.0.4; charset=utf-8')
