"""The in-memory side of the cache (what runs when no Redis is configured): counters, their expiry and clearing."""
import time
import unittest
import uuid

from app.services.cache_service import CacheService


def _memory_cache() -> CacheService:
    cache = CacheService.__new__(CacheService)    # skip __init__: it would try to reach a Redis first
    cache._redis = None
    cache._memory_store = {}
    return cache


class TestCounters(unittest.TestCase):
    def setUp(self):
        self.cache = _memory_cache()
        self.key = f"test:counter:{uuid.uuid4().hex}"

    def test_a_counter_counts(self):
        self.assertEqual([self.cache.incr(self.key) for _ in range(3)], [1, 2, 3])

    def test_a_counter_with_an_expiry_forgets_itself_and_keeps_the_first_deadline(self):
        self.assertEqual(self.cache.incr(self.key, ex=1), 1)
        deadline = self.cache._memory_store[self.key][1]
        self.assertEqual(self.cache.incr(self.key, ex=1000), 2, "later increments do not push the deadline out")
        self.assertEqual(self.cache._memory_store[self.key][1], deadline)
        self.cache._memory_store[self.key] = ("2", time.time() - 1)
        self.assertEqual(self.cache.incr(self.key, ex=1), 1, "an expired counter starts again")

    def test_a_counter_without_an_expiry_never_expires(self):
        self.cache.incr(self.key)
        self.assertIsNone(self.cache._memory_store[self.key][1])

    def test_clear_prefix_removes_only_what_matches(self):
        self.cache.set("test:keep:1", "x")
        self.cache.incr("test:drop:1")
        self.cache.incr("test:drop:2")
        self.cache.clear_prefix("test:drop:")
        self.assertIsNone(self.cache.get("test:drop:1"))
        self.assertIsNone(self.cache.get("test:drop:2"))
        self.assertEqual(self.cache.get("test:keep:1"), "x")


if __name__ == "__main__":
    unittest.main()
