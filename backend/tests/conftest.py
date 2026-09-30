"""Shared test setup.

Every test talks to the app through one in-process client, so all anonymous requests (every login) come from a single
address and share the rate limiter's per-minute budget. A suite of a few hundred requests would then start failing
with 429 depending on how fast the machine is. Each test starts with a fresh budget; the limiter itself is unchanged
and is still tested (test_p1_7 sets a counter above the limit and checks the answer).
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture(autouse=True)
def _fresh_rate_limit_budget():
    from app.services.cache_service import cache_service
    cache_service.clear_prefix("ratelimit:")
    yield
