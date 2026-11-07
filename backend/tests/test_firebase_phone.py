"""Sign in with Firebase Phone Authentication: the backend only checks the signed ID token Firebase gave the app.

The token is checked against Google's signing keys (replaced here by a key pair made for the test), for this Firebase project, as a
fresh phone sign-in. Everything after that is the same code as the SMS-code login.

Runs against the local development database; every row created here is removed again.
"""
import os
import sys
import time
import unittest
import uuid
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.main import app
from app.models import User
from app.services import firebase_phone as fp
from test_auth_security_regressions import SignInBase, switches

client = TestClient(app)

PROJECT = "ajanta-test"
KID = "test-key-1"
PRIVATE = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def token(phone="+919606595604", *, key=PRIVATE, kid=KID, aud=PROJECT, iss=None, provider="phone", auth_age=5, exp_in=3000,
          alg="RS256", with_phone=True, sub="firebase-uid-1"):
    now = int(time.time())
    claims = {
        "iss": iss or f"https://securetoken.google.com/{PROJECT}", "aud": aud, "sub": sub,
        "iat": now - auth_age, "auth_time": now - auth_age, "exp": now + exp_in,
        "firebase": {"sign_in_provider": provider, "identities": {}},
    }
    if with_phone:
        claims["phone_number"] = phone
    return jwt.encode(claims, key, algorithm=alg, headers={"kid": kid})


def keys():
    return patch.object(fp, "_public_keys", return_value={KID: PRIVATE.public_key()})


class TestTokenChecks(unittest.TestCase):
    def setUp(self):
        self._sw = switches(FIREBASE_PROJECT_ID=PROJECT)
        self._sw.__enter__()

    def tearDown(self):
        self._sw.__exit__(None, None, None)

    def check(self, tok):
        with keys():
            return fp.verified_phone(tok)

    def test_a_fresh_phone_token_for_this_project_gives_the_number(self):
        self.assertEqual(self.check(token()), "+919606595604")

    def test_every_other_kind_of_token_is_refused(self):
        bad = {
            "another project": token(aud="someone-elses-app", iss="https://securetoken.google.com/someone-elses-app"),
            "wrong issuer": token(iss="https://evil.example.com/ajanta-test"),
            "expired": token(exp_in=-600),
            "signed by another key": token(key=OTHER),
            "unknown key id": token(kid="not-a-google-key"),
            "a google sign-in, not a phone": token(provider="google.com"),
            "no phone number": token(with_phone=False),
            "phone verified long ago": token(auth_age=3600),
            "HS256 token": token(key="secret" * 8, alg="HS256"),
            "garbage": "not.a.token",
        }
        for why, tok in bad.items():
            with self.subTest(why), self.assertRaises(fp.FirebaseTokenError):
                self.check(tok)

    def test_when_google_cannot_be_reached_the_keys_already_held_are_used(self):
        held = {KID: PRIVATE.public_key()}
        with patch.dict(fp._keys, {"by_kid": held, "expires": 0.0}), patch.object(fp, "_fetch_keys", side_effect=RuntimeError("no network")):
            self.assertEqual(fp._public_keys(), held)

    def test_the_key_download_tries_ipv4_first_and_falls_back_to_the_ordinary_route(self):
        import httpx

        pem = None
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.x509.oid import NameOID
        import datetime

        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "test")])
        cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(PRIVATE.public_key())
                .serial_number(1).not_valid_before(datetime.datetime(2020, 1, 1)).not_valid_after(datetime.datetime(2099, 1, 1))
                .sign(PRIVATE, hashes.SHA256()))
        pem = cert.public_bytes(serialization.Encoding.PEM).decode()
        good = httpx.Response(200, json={KID: pem}, headers={"cache-control": "public, max-age=900"}, request=httpx.Request("GET", fp.CERTS_URL))
        transports = []

        class FakeClient:
            def __init__(self, *args, transport=None, **kwargs):
                transports.append(transport is not None)

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def get(self, url):
                if len(transports) == 1:  # the IPv4-only attempt fails
                    raise httpx.ConnectError("unreachable")
                return good

        with patch.object(fp.httpx, "Client", FakeClient):
            keys_by_kid, max_age = fp._fetch_keys()
        self.assertEqual(transports, [True, False], "IPv4-only first, then the ordinary route")
        self.assertEqual(list(keys_by_kid), [KID])
        self.assertEqual(max_age, 900)

    def test_with_no_keys_held_and_no_network_the_sign_in_fails_closed(self):
        with patch.dict(fp._keys, {"by_kid": {}, "expires": 0.0}), patch.object(fp, "_fetch_keys", side_effect=RuntimeError("no network")):
            with self.assertRaises(fp.FirebaseTokenError):
                fp.verified_phone(token())

    def test_an_unset_project_is_not_configured_rather_than_open(self):
        with switches(FIREBASE_PROJECT_ID="", FIREBASE_SERVICE_ACCOUNT_FILE=""), self.assertRaises(fp.FirebaseNotConfigured):
            fp.verified_phone(token())


class TestFirebaseSignInRoute(SignInBase):
    def post(self, tok, **extra):
        with keys():
            return client.post("/api/v1/auth/firebase-phone", json={"id_token": tok, **extra})

    def fresh(self):
        digits = f"{uuid.uuid4().int % 10**10:010d}"
        phone = f"+91{digits}"
        type(self).phones.append(phone)
        return phone

    def test_a_new_number_becomes_a_farmer_with_no_password_when_sign_up_is_open(self):
        phone = self.fresh()
        with switches(FIREBASE_PROJECT_ID=PROJECT, ENV="production", ALLOW_SELF_REGISTRATION=False, OPEN_PHONE_SIGNUP=True):
            r = self.post(token(phone))
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertTrue(body["access_token"])
        self.assertTrue(body["is_new_user"])
        self.db.expire_all()
        user = self.db.query(User).filter(User.phone == phone).one()
        self.assertEqual(user.role, "customer")
        self.assertIsNone(user.password_hash)
        self.assertIsNone(user.email)

    def test_an_existing_farmer_signs_in_to_the_same_account(self):
        farmer = self.make_user("customer", "fb-existing")
        with switches(FIREBASE_PROJECT_ID=PROJECT):
            r = self.post(token(farmer.phone))
        self.assertEqual(r.status_code, 200, r.text)
        self.assertFalse(r.json()["is_new_user"])
        self.assertEqual(r.json()["user"]["id"], str(farmer.id))

    def test_two_requests_for_the_same_new_number_make_one_account_and_both_sign_in(self):
        """A double tap or a retry after a slow answer used to crash the second request on the duplicate phone number."""
        phone = self.fresh()
        real_flush = Session.flush
        state = {"raced": False}

        def racing_flush(session, *args, **kwargs):
            if not state["raced"]:
                state["raced"] = True  # the other request makes the account just before this one does
                other = SessionLocal()
                other.execute(text("SET app.bypass_rls = 'on';"))
                other.add(User(id=uuid.uuid4(), full_name="Made first", phone=phone, phone_number=phone, role="customer",
                               hierarchy_path=f"/customers/{uuid.uuid4()}", account_status="ACTIVE", is_active=True))
                other.commit()
                other.close()
            return real_flush(session, *args, **kwargs)

        with switches(FIREBASE_PROJECT_ID=PROJECT, ENV="production", ALLOW_SELF_REGISTRATION=False, OPEN_PHONE_SIGNUP=True), \
                patch.object(Session, "flush", racing_flush):
            r = self.post(token(phone))
        self.assertEqual(r.status_code, 200, r.text)
        self.assertFalse(r.json()["is_new_user"])
        self.db.expire_all()
        self.assertEqual(self.db.query(User).filter(User.phone == phone).count(), 1)

    def test_a_new_number_is_refused_when_sign_up_is_closed(self):
        phone = self.fresh()
        with switches(FIREBASE_PROJECT_ID=PROJECT, ENV="production", ALLOW_SELF_REGISTRATION=False, OPEN_PHONE_SIGNUP=False):
            r = self.post(token(phone))
        self.assertEqual(r.status_code, 403, r.text)
        self.assertEqual(self.db.query(User).filter(User.phone == phone).count(), 0)

    def test_a_suspended_account_is_refused(self):
        farmer = self.make_user("customer", "fb-suspended")
        farmer = self.db.query(User).filter(User.id == farmer.id).one()
        farmer.account_status = "SUSPENDED"
        self.db.commit()
        with switches(FIREBASE_PROJECT_ID=PROJECT):
            r = self.post(token(farmer.phone))
        self.assertEqual(r.status_code, 403, r.text)

    def test_a_bad_token_is_a_401_and_signs_nobody_in(self):
        phone = self.fresh()
        with switches(FIREBASE_PROJECT_ID=PROJECT):
            forged = self.post(token(phone, key=OTHER))
            stale = self.post(token(phone, auth_age=3600))
        self.assertEqual((forged.status_code, stale.status_code), (401, 401))
        self.assertEqual(self.db.query(User).filter(User.phone == phone).count(), 0)

    def test_without_a_firebase_project_the_route_says_so(self):
        with switches(FIREBASE_PROJECT_ID="", FIREBASE_SERVICE_ACCOUNT_FILE=""):
            r = self.post(token())
        self.assertEqual(r.status_code, 503, r.text)


if __name__ == "__main__":
    unittest.main()
