"""The website has two logins, each by email and password: the Ajanta admin (registers farmers) and the super admin (monitors only).

Runs against the local development database; every row created here is removed again.
"""
import os
import sys
import unittest
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient

from app.api.auth import LOGIN_MAX_FAILURES
from app.main import app
from app.models import User
from app.services.cache_service import cache_service
from test_auth_security_regressions import SignInBase, switches
from test_web_portal_hardening import PASSWORD

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
import create_portal_accounts as script  # noqa: E402

client = TestClient(app)


def email():
    return f"portal-{uuid.uuid4().hex[:8]}@example.com"


class TestEmailLogin(SignInBase):
    def admin(self, address):
        user = self.make_user("manufacturer", "ajanta-admin")
        user = self.db.query(User).filter(User.id == user.id).one()
        user.email = address
        self.db.commit()
        return user

    def login(self, address, password=PASSWORD):  # noqa: D401 (shadows the phone login helper on purpose)
        return client.post("/api/v1/auth/login-email", json={"email": address, "password": password})

    def test_an_email_and_password_sign_in(self):
        address = email()
        user = self.admin(address)
        r = self.login(address)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["user"]["id"], str(user.id))
        self.assertTrue(r.json()["access_token"])

    def test_the_email_may_be_typed_in_any_case_with_spaces(self):
        address = email()
        self.admin(address)
        self.assertEqual(self.login(f"  {address.upper()} ").status_code, 200)

    def test_a_wrong_password_and_an_unknown_email_get_the_same_answer(self):
        address = email()
        self.admin(address)
        wrong = self.login(address, "not-the-password")
        unknown = self.login(email(), PASSWORD)
        self.assertEqual((wrong.status_code, unknown.status_code), (401, 401))
        self.assertEqual(wrong.json()["detail"], unknown.json()["detail"])

    def test_repeated_wrong_passwords_lock_the_email(self):
        address = email()
        self.admin(address)
        key = f"login_fail:email:{address}"
        cache_service.delete(key)
        try:
            for _ in range(LOGIN_MAX_FAILURES):
                self.assertEqual(self.login(address, "wrong-password").status_code, 401)
            self.assertEqual(self.login(address, PASSWORD).status_code, 429, "even the right password waits out the lock")
        finally:
            cache_service.delete(key)

    def test_a_suspended_account_cannot_sign_in(self):
        address = email()
        user = self.admin(address)
        user.account_status = "SUSPENDED"
        self.db.commit()
        self.assertEqual(self.login(address).status_code, 403)

    def test_an_account_without_a_password_cannot_sign_in_by_email(self):
        address = email()
        user = self.admin(address)
        user.password_hash = None
        self.db.commit()
        self.assertEqual(self.login(address).status_code, 401)


class TestSuperAdminMonitorsOnly(SignInBase):
    def headers(self, role):
        user = self.make_user(role, f"monitor-{role}")
        return self.bearer(self.login(user).json())

    def test_with_the_switch_on_the_super_admin_can_read_but_not_change_anything(self):
        with switches(SUPERADMIN_MONITOR_ONLY=True):
            headers = self.headers("superadmin")
            self.assertEqual(client.get("/api/v1/pumps", headers=headers).status_code, 200)
            self.assertEqual(client.get("/api/v1/farmers", headers=headers).status_code, 200)
            for method, path in (("post", "/api/v1/batches"), ("delete", f"/api/v1/pumps/{uuid.uuid4().hex[:8]}"),
                                 ("post", "/api/v1/farmers"), ("put", "/api/v1/brands/ajanta")):
                r = getattr(client, method)(path, headers=headers, **({"json": {}} if method in ("post", "put") else {}))
                self.assertEqual(r.status_code, 403, (method, path, r.text))
                self.assertIn("monitoring", r.json()["detail"], (method, path))

    def test_the_one_thing_it_may_do_is_make_a_manufacturer_and_only_that(self):
        with switches(SUPERADMIN_MONITOR_ONLY=True):
            headers = self.headers("superadmin")
            # a manufacturer's brand and login get past the monitoring guard (an empty body then fails on its own: 422)
            self.assertEqual(client.post("/api/v1/brands", json={}, headers=headers).status_code, 422)
            # any other account is refused by the rule for what a super admin may create
            for role in ("distributor", "dealer", "customer"):
                r = client.post("/api/v1/users", headers=headers, json={"full_name": "Someone", "phone_number": "9000000000", "role": role,
                                                                        "password": "Strong-Pass-1"})
                self.assertEqual(r.status_code, 403, (role, r.text))
                self.assertIn("manufacturer", r.json()["detail"])

    def test_the_super_admin_can_still_sign_in_refresh_and_sign_out(self):
        with switches(SUPERADMIN_MONITOR_ONLY=True):
            user = self.make_user("superadmin", "monitor-session")
            login = self.login(user)
            self.assertEqual(login.status_code, 200, login.text)
            body = login.json()
            self.assertEqual(client.post("/api/v1/auth/refresh", json={"refresh_token": body["refresh_token"]}).status_code, 200)
            out = client.post("/api/v1/auth/logout", json={"refresh_token": body["refresh_token"]}, headers=self.bearer(body))
            self.assertNotEqual(out.status_code, 403, out.text)

    def test_with_the_switch_off_nothing_changes_for_the_super_admin(self):
        with switches(SUPERADMIN_MONITOR_ONLY=False):
            r = client.post("/api/v1/users", json={}, headers=self.headers("superadmin"))
            self.assertEqual(r.status_code, 422, "the request got past the guard and failed on its empty body instead")

    def test_the_switch_never_touches_the_ajanta_admin(self):
        with switches(SUPERADMIN_MONITOR_ONLY=True):
            r = client.post("/api/v1/farmers", json={}, headers=self.headers("manufacturer"))
            self.assertEqual(r.status_code, 422, r.text)


class TestCreatePortalAccounts(SignInBase):
    def tearDown(self):
        self.db.rollback()

    def test_a_super_admin_gets_an_email_a_password_hash_and_no_brand(self):
        address = email()
        user = script.create_account(self.db, "superadmin", "Platform Owner", address, "a-long-password-1")
        self.db.flush()
        self.assertEqual((user.role, user.email, user.brand_id), ("superadmin", address, None))
        self.assertNotEqual(user.password_hash, "a-long-password-1")
        self.assertIsNone(user.phone_number)

    def test_the_ajanta_admin_becomes_the_brand_owner_when_asked_to(self):
        from app.models import AppBrand
        # Make sure the brand has an owner whatever the database held (rolled back in tearDown), so that a second admin is refused.
        script.create_account(self.db, "ajanta-admin", "First Owner", email(), "a-long-password-1", replace_owner=True)
        self.db.flush()
        with self.assertRaises(script.AccountError):
            script.create_account(self.db, "ajanta-admin", "Ajanta Admin", email(), "a-long-password-1")
        user =script.create_account(self.db, "ajanta-admin", "Ajanta Admin", email(), "a-long-password-1", replace_owner=True)
        self.db.flush()
        brand = self.db.query(AppBrand).filter(AppBrand.key == "ajanta").one()
        self.assertEqual(brand.owner_user_id, user.id)
        self.assertEqual((user.role, user.brand_id), ("manufacturer", brand.id))
        self.assertTrue(user.hierarchy_path.startswith("/SA/"))

    def test_a_short_password_a_bad_email_and_a_second_account_for_one_email_are_refused(self):
        with self.assertRaises(script.AccountError):
            script.create_account(self.db, "superadmin", "X", email(), "short")
        with self.assertRaises(script.AccountError):
            script.create_account(self.db, "superadmin", "X", "not-an-email", "a-long-password-1")
        address = email()
        script.create_account(self.db, "superadmin", "First", address, "a-long-password-1")
        self.db.flush()
        with self.assertRaises(script.AccountError):
            script.create_account(self.db, "superadmin", "Second", address.upper(), "a-long-password-1")


if __name__ == "__main__":
    unittest.main()
