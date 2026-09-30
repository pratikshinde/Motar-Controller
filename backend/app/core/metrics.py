import time
import os
import threading
from typing import Dict, Any, List
from collections import defaultdict

class MetricsCollector:
    """
    Lightweight, thread-safe in-memory metrics collector (FR-CLD-047).
    Tracks request rates, latency percentiles, error rates, and queue/DB stats.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._start_time = time.time()
        self._request_count = 0
        self._error_4xx_count = 0
        self._error_5xx_count = 0
        self._endpoint_counts: Dict[str, int] = defaultdict(int)
        self._latencies: List[float] = []
        self._max_latency_samples = 2000
        self._counters: Dict[str, int] = defaultdict(int)
        self._timings: Dict[str, List[float]] = defaultdict(list)

    def incr(self, name: str, by: int = 1):
        """A named counter (cache hits, websocket connections, ...)."""
        with self._lock:
            self._counters[name] += by

    def observe(self, name: str, value_ms: float):
        """A named timing sample; the newest 500 are kept."""
        with self._lock:
            samples = self._timings[name]
            samples.append(value_ms)
            if len(samples) > 500:
                del samples[:-500]

    def record_request(self, method: str, path: str, status_code: int, duration_ms: float):
        with self._lock:
            self._request_count += 1
            if 400 <= status_code < 500:
                self._error_4xx_count += 1
            elif status_code >= 500:
                self._error_5xx_count += 1

            # Normalize path for route grouping (e.g. collapse specific pump IDs)
            route_bucket = f"{method} {path.split('?')[0]}"
            self._endpoint_counts[route_bucket] += 1

            self._latencies.append(duration_ms)
            if len(self._latencies) > self._max_latency_samples:
                # Keep the latest samples
                self._latencies = self._latencies[-self._max_latency_samples:]

    def get_stats(self) -> Dict[str, Any]:
        with self._lock:
            uptime = time.time() - self._start_time
            sorted_latencies = sorted(self._latencies) if self._latencies else [0.0]
            n = len(sorted_latencies)

            p50 = sorted_latencies[int(n * 0.50)] if n else 0.0
            p90 = sorted_latencies[int(n * 0.90)] if n else 0.0
            p95 = sorted_latencies[int(n * 0.95)] if n else 0.0
            p99 = sorted_latencies[int(n * 0.99)] if n else 0.0

            rps = round(self._request_count / max(1.0, uptime), 2)
            error_rate = round(
                ((self._error_4xx_count + self._error_5xx_count) / max(1, self._request_count)) * 100, 2
            )

            return {
                "uptime_seconds": int(uptime),
                "requests_total": self._request_count,
                "requests_per_second": rps,
                "errors_4xx": self._error_4xx_count,
                "errors_5xx": self._error_5xx_count,
                "error_rate_percent": error_rate,
                "latency_ms": {
                    "p50": round(p50, 2),
                    "p90": round(p90, 2),
                    "p95": round(p95, 2),
                    "p99": round(p99, 2),
                    "samples": n
                },
                "top_endpoints": dict(sorted(self._endpoint_counts.items(), key=lambda x: x[1], reverse=True)[:10]),
                "counters": dict(self._counters),
                "timings_ms": {
                    name: {
                        "p50": round(sorted(v)[int(len(v) * 0.50)], 2),
                        "p95": round(sorted(v)[min(len(v) - 1, int(len(v) * 0.95))], 2),
                        "samples": len(v),
                    }
                    for name, v in self._timings.items() if v
                },
            }

metrics_collector = MetricsCollector()

def init_sentry():
    """
    Initializes Sentry SDK if SENTRY_DSN is configured in environment.
    """
    sentry_dsn = os.getenv("SENTRY_DSN")
    if not sentry_dsn:
        return False
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

        sentry_sdk.init(
            dsn=sentry_dsn,
            traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.2")),
            integrations=[FastApiIntegration(), SqlalchemyIntegration()]
        )
        return True
    except Exception as e:
        print(f"Notice: Sentry init skipped: {e}")
        return False
