"""
Prometheus Observability & Metrics Instrumentator for NETRA-X Platform.
Exposes standard Prometheus metrics format via GET /metrics endpoint.
Tracks request throughput, status codes, latency distributions, LLR fusion metrics, and audit log events.
"""

import time
import threading
from typing import Dict, Tuple
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware


class MetricsCollector:
    """Thread-safe Prometheus metrics collector for NETRA-X API."""

    def __init__(self):
        self._lock = threading.Lock()
        self._requests_total: Dict[Tuple[str, str, int], int] = {}
        self._request_duration_seconds: Dict[str, float] = {}
        self._llr_evaluations_total: int = 0
        self._audit_events_total: int = 0
        self._active_connections: int = 0

    def record_request(self, method: str, path: str, status_code: int, duration_sec: float):
        """Record an incoming HTTP request execution."""
        # Sanitize path to prevent high cardinality
        normalized_path = path
        if "/api/v1/hypotheses/" in path and "/review" in path:
            normalized_path = "/api/v1/hypotheses/{id}/review"
        elif "/api/v1/cases/" in path:
            normalized_path = "/api/v1/cases/{id}"
        elif "/api/v1/actors/" in path:
            normalized_path = "/api/v1/actors/{id}"

        key = (method, normalized_path, status_code)
        with self._lock:
            self._requests_total[key] = self._requests_total.get(key, 0) + 1
            self._request_duration_seconds[normalized_path] = self._request_duration_seconds.get(normalized_path, 0.0) + duration_sec

    def record_llr_evaluation(self):
        """Increment count of Log-Likelihood Ratio fusion engine evaluations."""
        with self._lock:
            self._llr_evaluations_total += 1

    def record_audit_event(self):
        """Increment count of cryptographic audit log events recorded."""
        with self._lock:
            self._audit_events_total += 1

    def generate_prometheus_text(self) -> str:
        """Render standard Prometheus exposition text format (v0.0.4)."""
        lines = []

        # HELP and TYPE for netrax_http_requests_total
        lines.append("# HELP netrax_http_requests_total Total number of HTTP requests handled by NETRA-X API.")
        lines.append("# TYPE netrax_http_requests_total counter")
        with self._lock:
            for (method, path, status_code), count in self._requests_total.items():
                lines.append(f'netrax_http_requests_total{{method="{method}",path="{path}",status="{status_code}"}} {count}')

        # HELP and TYPE for netrax_llr_evaluations_total
        lines.append("\n# HELP netrax_llr_evaluations_total Total number of LLR fusion attribution evaluations executed.")
        lines.append("# TYPE netrax_llr_evaluations_total counter")
        lines.append(f"netrax_llr_evaluations_total {self._llr_evaluations_total}")

        # HELP and TYPE for netrax_audit_events_total
        lines.append("\n# HELP netrax_audit_events_total Total number of SHA-256 hash-chained audit log events created.")
        lines.append("# TYPE netrax_audit_events_total counter")
        lines.append(f"netrax_audit_events_total {self._audit_events_total}")

        return "\n".join(lines) + "\n"


# Singleton Global Collector
metrics_collector = MetricsCollector()


class MetricsMiddleware(BaseHTTPMiddleware):
    """FastAPI Middleware to time HTTP requests and record Prometheus metrics."""

    async def dispatch(self, request: Request, call_next) -> Response:
        start_time = time.time()
        response = await call_next(request)
        duration = time.time() - start_time

        # Skip recording metrics endpoint itself to avoid recursion
        if request.url.path != "/metrics":
            metrics_collector.record_request(
                method=request.method,
                path=request.url.path,
                status_code=response.status_code,
                duration_sec=duration
            )

        return response
