import sys
import os
import unittest
import json
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from app.main import app
from app.core.logging import mask_sensitive_data, StructuredJSONFormatter
from app.core.metrics import metrics_collector
import logging

client = TestClient(app)

class TestP1_8Observability(unittest.TestCase):
    """
    Test suite for P1.8 Observability baseline (FR-CLD-047, NFR-M-004).
    """

    def test_01_system_version_endpoint(self):
        """Verify /v1/system/version returns service metadata and commit info."""
        for path in ["/api/v1/system/version", "/api/system/version"]:
            resp = client.get(path)
            self.assertEqual(resp.status_code, 200, f"Failed for {path}")
            data = resp.json()
            self.assertEqual(data["service"], "agripump-backend")
            self.assertIn("version", data)
            self.assertIn("git_commit", data)
            self.assertIn("environment", data)
            self.assertIn("uptime_seconds", data)
            self.assertIn("database", data)
            print(f"\n[PASS] Verified {path}: Version {data['version']}, commit {data['git_commit']}")

    def test_02_system_metrics_endpoint(self):
        """Verify /v1/system/metrics returns latency percentiles, request counts, and error rates."""
        resp = client.get("/api/v1/system/metrics")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("metrics", data)
        metrics = data["metrics"]
        self.assertIn("requests_total", metrics)
        self.assertIn("latency_ms", metrics)
        self.assertIn("p50", metrics["latency_ms"])
        self.assertIn("p95", metrics["latency_ms"])
        self.assertIn("p99", metrics["latency_ms"])
        print(f"[PASS] Metrics endpoint verified: Total requests={metrics['requests_total']}, p95={metrics['latency_ms']['p95']}ms")

    def test_03_request_id_tracing_header(self):
        """Verify requests receive an X-Request-ID header and respect client-provided correlation IDs."""
        # 1. Generated Request ID
        resp1 = client.get("/api/v1/system/health")
        self.assertEqual(resp1.status_code, 200)
        req_id1 = resp1.headers.get("X-Request-ID")
        self.assertTrue(bool(req_id1), "X-Request-ID header missing from response")

        # 2. Propagated Request ID
        custom_id = f"trace-{uuid.uuid4().hex}"
        resp2 = client.get("/api/v1/system/health", headers={"X-Request-ID": custom_id})
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(resp2.headers.get("X-Request-ID"), custom_id)
        print(f"[PASS] Distributed tracing confirmed: X-Request-ID propagated correctly ({custom_id})")

    def test_04_sensitive_data_masking(self):
        """Verify tokens, passwords, OTPs, and phone numbers are redacted from logs (FR-CLD-047)."""
        raw_token = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.abc123xyz"
        masked_token = mask_sensitive_data(f"User header: {raw_token}")
        self.assertNotIn("abc123xyz", masked_token)
        self.assertIn("Bearer ***", masked_token)

        raw_pwd = 'User payload: {"phone": "+919876543210", "password": "SuperSecretPassword123"}'
        masked_pwd = mask_sensitive_data(raw_pwd)
        self.assertNotIn("SuperSecretPassword123", masked_pwd)
        self.assertIn('"password": "***"', masked_pwd)
        # Phone middle digits masked
        self.assertNotIn("9876543210", masked_pwd)
        self.assertIn("+9198****210", masked_pwd)

        raw_otp = 'Challenge verification: {"phone": "+919741323830", "otp_code": "849201"}'
        masked_otp = mask_sensitive_data(raw_otp)
        self.assertNotIn("849201", masked_otp)
        self.assertIn('"otp_code": "***"', masked_otp)

        print("[PASS] Sensitive data masking verified: tokens, passwords, OTPs, and phone numbers properly redacted!")

    def test_05_structured_json_formatter(self):
        """Verify StructuredJSONFormatter produces valid single-line JSON with required fields."""
        formatter = StructuredJSONFormatter()
        record = logging.LogRecord(
            name="agripump.test",
            level=logging.INFO,
            pathname=__file__,
            lineno=10,
            msg='Test message with token Bearer secret_12345',
            args=(),
            exc_info=None
        )
        record.request_id = "test-req-001"
        record.user_id = "test-user-002"

        formatted = formatter.format(record)
        parsed = json.loads(formatted)
        self.assertEqual(parsed["level"], "INFO")
        self.assertEqual(parsed["logger"], "agripump.test")
        self.assertEqual(parsed["request_id"], "test-req-001")
        self.assertEqual(parsed["user_id"], "test-user-002")
        self.assertIn("Bearer ***", parsed["message"])
        self.assertNotIn("secret_12345", parsed["message"])
        print(f"[PASS] Structured JSON formatter output valid: {formatted}")

if __name__ == "__main__":
    unittest.main()
