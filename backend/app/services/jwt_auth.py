import os
import time
import secrets
import hashlib
import hmac
import jwt
from typing import Optional, Dict, Any, Tuple
from app.config import settings

ACCESS_TOKEN_TTL_SECONDS = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
REFRESH_TOKEN_TTL_SECONDS = settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60

def hash_secret(secret: str, custom_salt: Optional[str] = None) -> str:
    """
    Matches Node.js scryptSync(secret, salt_string, 64) with format 'salt:hash'.
    """
    salt = custom_salt or secrets.token_hex(16)
    # salt is passed as utf-8 string bytes
    salt_bytes = salt.encode("utf-8")
    derived_key = hashlib.scrypt(
        secret.encode("utf-8"),
        salt=salt_bytes,
        n=16384,
        r=8,
        p=1,
        dklen=64
    ).hex()
    return f"{salt}:{derived_key}"

def verify_secret(input_secret: str, stored_salt_hash: Optional[str]) -> bool:
    if not stored_salt_hash or not input_secret:
        return False
        
    if ":" not in stored_salt_hash:
        # Legacy unsalted SHA-256 fallback
        legacy_hash = hashlib.sha256(input_secret.encode("utf-8")).hexdigest()
        return hmac.compare_digest(legacy_hash, stored_salt_hash)
        
    parts = stored_salt_hash.split(":", 1)
    if len(parts) != 2:
        return False
    salt, original_hash = parts
    computed_hash = hashlib.scrypt(
        input_secret.encode("utf-8"),
        salt=salt.encode("utf-8"),
        n=16384,
        r=8,
        p=1,
        dklen=64
    ).hex()
    return hmac.compare_digest(computed_hash, original_hash)

def generate_refresh_token() -> str:
    return secrets.token_urlsafe(32)

def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

def sign_token(payload: Dict[str, Any], expires_in_seconds: int = ACCESS_TOKEN_TTL_SECONDS) -> str:
    now = int(time.time())
    token_payload = {
        **payload,
        "iat": now,
        "exp": now + expires_in_seconds
    }
    return jwt.encode(token_payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)

def verify_token(token: str) -> Optional[Dict[str, Any]]:
    if not token:
        return None
    try:
        decoded = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
            options={"verify_exp": True}
        )
        return decoded
    except Exception:
        return None
