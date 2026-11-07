"""Sign in with Firebase Phone Authentication.

The app asks Firebase to SMS a code to the farmer's number, the farmer types it, and Firebase hands the app a signed ID token that
says "this phone number was verified just now". The backend never sends or sees the code: it only checks that token, here, against
Google's published signing keys, and then signs the person in exactly as the SMS-code login does.

A token is accepted only when ALL of these hold: signed by Google's key (RS256), issued for this Firebase project (audience and
issuer), not expired, the sign-in provider is "phone", it carries a phone number, and the person verified that number in the last
ten minutes (so an old token that leaked cannot be replayed).
"""
import logging
import threading
import time
from typing import Dict, Optional

import httpx
import jwt
from cryptography import x509

from app.config import settings
from app.core.phone import normalize_phone
from app.services import push

logger = logging.getLogger(__name__)

CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
MAX_AUTH_AGE_SECONDS = 600
_LEEWAY_SECONDS = 60

_lock = threading.Lock()
_keys: Dict[str, object] = {"by_kid": {}, "expires": 0.0}


class FirebaseNotConfigured(Exception):
    """No Firebase project is set up on this server."""


class FirebaseTokenError(Exception):
    """The token is not a valid, fresh phone sign-in for this project. The message is for the log, never for the client."""


def project_id() -> str:
    """The Firebase project: FIREBASE_PROJECT_ID, else the project of the service-account key push already uses."""
    configured = (settings.FIREBASE_PROJECT_ID or "").strip()
    if configured:
        return configured
    account = push._key_file() or {}
    pid = str(account.get("project_id") or "").strip()
    if not pid:
        raise FirebaseNotConfigured("FIREBASE_PROJECT_ID is not set")
    return pid


def enabled() -> bool:
    try:
        project_id()
        return True
    except FirebaseNotConfigured:
        return False


def _fetch_keys() -> "tuple[Dict[str, object], int]":
    """Download Google's current signing keys (a short, bounded wait) and how long Google lets us keep them."""
    # IPv4 first: on some networks the IPv6 route to Google hangs, and Python then tries every IPv6 address in turn (a download that
    # takes 0.3 s with curl took two minutes). Binding the local address to 0.0.0.0 makes the connection IPv4-only; the ordinary
    # route is the fallback for a network that has only IPv6.
    res = None
    last_error: Optional[Exception] = None
    for transport in (httpx.HTTPTransport(local_address="0.0.0.0"), None):
        try:
            with httpx.Client(timeout=httpx.Timeout(6.0, connect=3.0), transport=transport) as client:
                res = client.get(CERTS_URL)
            res.raise_for_status()
            break
        except Exception as exc:
            last_error, res = exc, None
    if res is None:
        raise last_error  # type: ignore[misc]
    by_kid = {kid: x509.load_pem_x509_certificate(pem.encode("utf-8")).public_key() for kid, pem in res.json().items()}
    max_age = 3600
    for part in res.headers.get("cache-control", "").split(","):
        part = part.strip()
        if part.startswith("max-age="):
            try:
                max_age = int(part.split("=", 1)[1])
            except ValueError:
                pass
    return by_kid, max_age


def _public_keys(force: bool = False) -> Dict[str, object]:
    """Google's current signing keys by key id, cached for as long as Google says. The download happens outside the lock (so one slow
    download cannot queue every sign-in behind it), and if Google cannot be reached the keys already held are used."""
    now = time.time()
    with _lock:
        held = dict(_keys["by_kid"])  # type: ignore[arg-type]
        fresh = bool(held) and float(_keys["expires"]) > now
    if fresh and not force:
        return held
    try:
        by_kid, max_age = _fetch_keys()
    except Exception as exc:
        if held:
            logger.warning("Google's signing keys could not be refreshed (%s); using the ones already held", exc)
            return held
        raise
    with _lock:
        _keys["by_kid"], _keys["expires"] = by_kid, time.time() + max(60, max_age)
    return dict(by_kid)


def warm_up() -> None:
    """Fetch the signing keys in the background at startup (no-op when Firebase is not set up). Never raises."""
    if not enabled():
        return

    def _go() -> None:
        try:
            _public_keys(force=True)
            logger.info("Firebase signing keys loaded")
        except Exception as exc:
            logger.warning("Firebase signing keys could not be loaded at startup (%s); they will be fetched at the first sign-in", exc)

    threading.Thread(target=_go, name="firebase-keys-warmup", daemon=True).start()


def verified_phone(id_token: str) -> str:
    """The phone number (as stored: "+91...") that Firebase says was verified, or raises FirebaseTokenError / FirebaseNotConfigured."""
    project = project_id()
    try:
        header = jwt.get_unverified_header(id_token)
        if header.get("alg") != "RS256" or not header.get("kid"):
            raise FirebaseTokenError("unexpected token header")
        keys = _public_keys()
        if header["kid"] not in keys:
            keys = _public_keys(force=True)  # Google rotated its keys
        key = keys.get(header["kid"])
        if key is None:
            raise FirebaseTokenError("unknown signing key")
        claims = jwt.decode(
            id_token,
            key,  # type: ignore[arg-type]
            algorithms=["RS256"],
            audience=project,
            issuer=f"https://securetoken.google.com/{project}",
            leeway=_LEEWAY_SECONDS,
            options={"require": ["exp", "iat", "sub", "aud", "iss"]},
        )
    except FirebaseTokenError:
        raise
    except Exception as exc:  # bad signature, expired, wrong project, network: all mean "not verified"
        raise FirebaseTokenError(f"{type(exc).__name__}: {exc}") from exc

    if (claims.get("firebase") or {}).get("sign_in_provider") != "phone":
        raise FirebaseTokenError("not a phone sign-in")
    if not str(claims.get("sub") or "").strip():
        raise FirebaseTokenError("no subject")
    auth_time = claims.get("auth_time")
    now = time.time()
    if not isinstance(auth_time, (int, float)) or auth_time > now + _LEEWAY_SECONDS or now - auth_time > MAX_AUTH_AGE_SECONDS:
        raise FirebaseTokenError("the phone was not verified in the last few minutes")
    phone = normalize_phone(str(claims.get("phone_number") or ""))
    if len(phone) < 10:
        raise FirebaseTokenError("no phone number in the token")
    return phone
