"""Push notifications to the phones that have the app, through Firebase Cloud Messaging (HTTP v1).

Off until FIREBASE_SERVICE_ACCOUNT_FILE points at the project's service-account key. The key never leaves this machine and is never
logged. The access token it earns lasts an hour and is reused. Nothing here raises: a failed push is logged and must not hold up
the sweep or the ingest worker. A token that Firebase says no longer exists (the app was removed or data cleared) is deleted.
"""
import json
import logging
import os
import threading
import time
from typing import Dict, Iterable, List, Optional

import httpx
import jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.models import DeviceAccess, Pump
from app.models.push_token import PushToken

logger = logging.getLogger(__name__)

_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
_lock = threading.Lock()
_cached: Dict[str, object] = {"token": None, "expires": 0.0}


def _key_file() -> Optional[dict]:
    path = (settings.FIREBASE_SERVICE_ACCOUNT_FILE or "").strip()
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        logger.warning("The Firebase service-account file could not be read")
        return None
    return data if data.get("private_key") and data.get("client_email") and data.get("project_id") else None


def enabled() -> bool:
    return _key_file() is not None


def _access_token(account: dict) -> Optional[str]:
    """A Google OAuth token for the service account (a signed JWT exchanged at the token endpoint), cached until shortly before it expires."""
    now = time.time()
    with _lock:
        if _cached["token"] and float(_cached["expires"]) > now + 60:
            return str(_cached["token"])
        token_uri = account.get("token_uri") or "https://oauth2.googleapis.com/token"
        assertion = jwt.encode(
            {"iss": account["client_email"], "scope": _SCOPE, "aud": token_uri, "iat": int(now), "exp": int(now) + 3600},
            account["private_key"],
            algorithm="RS256",
        )
        try:
            with httpx.Client(timeout=10.0) as client:
                res = client.post(
                    token_uri, data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion}
                )
            if res.status_code != 200:
                logger.warning("Firebase did not give an access token (%s)", res.status_code)
                return None
            body = res.json()
        except Exception as exc:
            logger.warning("Firebase access token request failed: %s", exc)
            return None
        _cached["token"] = body.get("access_token")
        _cached["expires"] = now + float(body.get("expires_in", 3600))
        return str(_cached["token"]) if _cached["token"] else None


def send_to_token(token: str, title: str, body: str, data: Optional[Dict[str, str]] = None) -> str:
    """One push to one phone. Returns "ok", "invalid" (the token is dead: delete it) or "error"."""
    account = _key_file()
    if account is None:
        return "error"
    access = _access_token(account)
    if not access:
        return "error"
    message = {
        "message": {
            "token": token,
            "notification": {"title": title, "body": body},
            "data": {k: str(v) for k, v in (data or {}).items()},
            "android": {"priority": "HIGH", "notification": {"channel_id": "alerts", "sound": "default"}},
        }
    }
    try:
        with httpx.Client(timeout=10.0) as client:
            res = client.post(
                f"https://fcm.googleapis.com/v1/projects/{account['project_id']}/messages:send",
                headers={"Authorization": f"Bearer {access}"},
                json=message,
            )
    except Exception as exc:
        logger.warning("Push could not be sent: %s", exc)
        return "error"
    if res.status_code == 200:
        return "ok"
    if res.status_code in (404, 400) and any(w in res.text for w in ("UNREGISTERED", "INVALID_ARGUMENT", "NOT_FOUND")):
        return "invalid"
    logger.warning("Push was refused by Firebase (%s)", res.status_code)
    return "error"


def pump_user_ids(db: Session, pump_id: str) -> List:
    """Everyone who can see the pump: its owner and the people it was shared with."""
    pump = db.query(Pump).filter(Pump.id == pump_id).first()
    ids = {pump.owner_user_id} if pump and pump.owner_user_id else set()
    ids.update(uid for (uid,) in db.query(DeviceAccess.user_id).filter(DeviceAccess.device_id == pump_id))
    return list(ids)


def notify_users(db: Session, user_ids: Iterable, title: str, body: str, data: Optional[Dict[str, str]] = None) -> int:
    """Push to every phone of these people. Returns how many were accepted."""
    if not enabled():
        return 0
    sent = 0
    for row in db.query(PushToken).filter(PushToken.user_id.in_(list(user_ids))).all():
        outcome = send_to_token(row.token, title, body, data)
        if outcome == "ok":
            sent += 1
        elif outcome == "invalid":
            db.delete(row)
    db.commit()
    return sent


def notify_pump(db: Session, pump_id: str, title: str, body: str) -> int:
    """Push about one pump to everyone who can see it; tapping it opens that pump."""
    return notify_users(db, pump_user_ids(db, pump_id), title, body, {"pump_id": pump_id})
