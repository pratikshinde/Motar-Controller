import time
import logging
from typing import Optional, Dict, Any, Tuple
from app.config import settings

logger = logging.getLogger("agripump.cache")

class CacheService:
    """
    Unified Redis / in-memory cache supporting session_version revocation (FR-CLD-041),
    rate-limiting, and token reuse invalidation.
    """

    def __init__(self):
        self._redis = None
        self._memory_store: Dict[str, Tuple[Any, Optional[float]]] = {}
        self._init_redis()

    def _init_redis(self):
        redis_url = getattr(settings, "REDIS_URL", None) or "redis://localhost:6379/0"
        try:
            import redis
            client = redis.Redis.from_url(redis_url, decode_responses=True, socket_timeout=1.0)
            client.ping()
            self._redis = client
            logger.info("Connected to Redis at %s", redis_url)
        except Exception as e:
            self._redis = None
            logger.info("Redis not available (%s); using thread-safe in-memory cache fallback", e)

    def get(self, key: str) -> Optional[str]:
        if self._redis:
            try:
                return self._redis.get(key)
            except Exception:
                pass

        # In-memory fallback
        if key in self._memory_store:
            val, exp = self._memory_store[key]
            if exp and time.time() > exp:
                del self._memory_store[key]
                return None
            return str(val)
        return None

    def set(self, key: str, value: Any, ex: Optional[int] = None) -> None:
        if self._redis:
            try:
                self._redis.set(key, str(value), ex=ex)
                return
            except Exception:
                pass

        exp = time.time() + ex if ex else None
        self._memory_store[key] = (str(value), exp)

    def incr(self, key: str, ex: Optional[int] = None) -> int:
        """Add one and return the new count. With `ex`, a counter that has just been created expires after that many
        seconds (rate-limit windows), so old windows do not pile up; without it the counter never expires."""
        if self._redis:
            try:
                value = int(self._redis.incr(key))
                if ex and value == 1:
                    self._redis.expire(key, ex)
                return value
            except Exception:
                pass

        current = int(self.get(key) or 0)
        new_val = current + 1
        kept = self._memory_store.get(key)
        expires_at = kept[1] if kept and kept[1] else (time.time() + ex if ex else None)
        self._memory_store[key] = (str(new_val), expires_at)
        return new_val

    def clear_prefix(self, prefix: str) -> None:
        """Forget every key that starts with `prefix` (tests and maintenance; not used on a request path)."""
        if self._redis:
            try:
                for key in self._redis.scan_iter(match=f"{prefix}*"):
                    self._redis.delete(key)
                return
            except Exception:
                pass
        for key in [k for k in self._memory_store if k.startswith(prefix)]:
            self._memory_store.pop(key, None)

    def delete(self, key: str) -> None:
        if self._redis:
            try:
                self._redis.delete(key)
                return
            except Exception:
                pass
        self._memory_store.pop(key, None)

    def get_user_session_version(self, user_id: str) -> int:
        """Returns the active session version for user (default 1)."""
        val = self.get(f"user:{user_id}:session_version")
        return int(val) if val else 1

    def increment_user_session_version(self, user_id: str) -> int:
        """Revokes all active JWTs for user within <= 60s (FR-CLD-041)."""
        key = f"user:{user_id}:session_version"
        new_ver = self.incr(key)
        if new_ver == 1:
            # The key did not exist, so the version before this bump was the implicit default of 1: go to 2.
            new_ver = self.incr(key)
        return new_ver

cache_service = CacheService()
