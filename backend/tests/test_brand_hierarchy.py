"""A brand can have its own hierarchy and admin sign-in (brands.features), without a second backend.

  "hierarchy": "admin_users"   super admin > admin > users: the admin adds users directly, no distributors or dealers.
  "admin_login": "email_code"  the admin signs in with an emailed code, never with a password.

Runs against the local development database; no email is really sent (the sender is replaced).
"""
import os
import sys
import unittest
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.models import AppBrand, User
from app.services import brand_service
from app.services.jwt_auth import hash_secret
from test_email_login import API, EmailBase  # noqa: E402

client = TestClient(app)
PASSWORD = "Secret-pass-1"


class BrandBase(EmailBase):
    brand_ids = []

    @classmethod
    def tearDownClass(cls):
        try:
            cls.db.rollback()
            cls.db.execute(text("SET app.bypass_rls = 'on';"))
            cls.db.query(User).filter(User.brand_id.in_(cls.brand_ids)).delete(synchronize_session=False)
            cls.db.query(AppBrand).filter(AppBrand.id.in_(cls.brand_ids)).delete(synchronize_session=False)
            cls.db.commit()
        finally:
            super().tearDownClass()

    def make_brand(self, **features):
        b = AppBrand(key=f"t{uuid.uuid4().hex[:8]}", name="Test brand", features=features, status="ACTIVE")
        self.db.add(b)
        self.db.commit()
        type(self).brand_ids.append(b.id)
        brand_service.forget()
        return b

    def admin_in(self, brand, tag="adm"):
        return self.account("manufacturer", tag, brand_id=brand.id)

    def sign_in_by_code(self, admin):
        self.ask(admin.email)
        r = self.enter(admin.email, self.inbox.code())
        self.assertEqual(r.status_code, 200, r.text)
        return {"Authorization": f"Bearer {r.json()['access_token']}"}


class TestAdminSignsInWithAnEmailedCode(BrandBase):
    def test_an_admin_of_a_code_brand_gets_a_code_and_signs_in(self):
        brand = self.make_brand(admin_login="email_code")
        admin = self.admin_in(brand)
        self.ask(admin.email)
        self.assertEqual(len(self.inbox.sent), 1)
        r = self.enter(admin.email, self.inbox.code())
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["user"]["role"], "manufacturer")

    def test_an_admin_of_a_password_brand_gets_no_code(self):
        brand = self.make_brand()
        admin = self.admin_in(brand)
        self.assertEqual(self.ask(admin.email).status_code, 200, "the same answer as for anyone")
        self.assertEqual(self.inbox.sent, [])
        self.assertEqual(self.enter(admin.email, "123456").status_code, 400)

    def test_a_code_brand_admin_cannot_use_a_password(self):
        brand = self.make_brand(admin_login="email_code")
        admin = self.admin_in(brand)
        admin.password_hash = hash_secret(PASSWORD)
        self.db.commit()
        r = client.post(f"{API}/login-email", json={"email": admin.email, "password": PASSWORD})
        self.assertEqual(r.status_code, 401, "a password gets the answer of a wrong one")

    def test_a_password_brand_admin_still_uses_a_password(self):
        brand = self.make_brand()
        admin = self.admin_in(brand)
        admin.password_hash = hash_secret(PASSWORD)
        self.db.commit()
        r = client.post(f"{API}/login-email", json={"email": admin.email, "password": PASSWORD})
        self.assertEqual(r.status_code, 200, r.text)


class TestNoDistributorsOrDealers(BrandBase):
    def create(self, headers, role, **extra):
        body = {"full_name": f"Person {uuid.uuid4().hex[:6]}", "phone_number": f"9{uuid.uuid4().int % 10**9:09d}", "role": role}
        body.update(extra)
        return client.post("/api/v1/users", json=body, headers=headers)

    def test_the_admin_of_an_admin_users_brand_adds_users_directly(self):
        brand = self.make_brand(admin_login="email_code", hierarchy="admin_users")
        headers = self.sign_in_by_code(self.admin_in(brand))
        r = self.create(headers, "customer", password=PASSWORD)
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(r.json()["user"]["role"], "customer")

    def test_no_distributor_or_dealer_in_that_brand(self):
        brand = self.make_brand(admin_login="email_code", hierarchy="admin_users")
        headers = self.sign_in_by_code(self.admin_in(brand))
        for role in ("distributor", "dealer"):
            r = self.create(headers, role)
            self.assertEqual(r.status_code, 403, f"{role}: {r.text}")

    def test_no_distributor_or_dealer_registration_or_invite_either(self):
        brand = self.make_brand(admin_login="email_code", hierarchy="admin_users")
        headers = self.sign_in_by_code(self.admin_in(brand))
        r = client.post("/api/v1/users/registrations", json={"role": "dealer", "full_name": "Dee", "phone_number": "9876500000", "address": "Somewhere"}, headers=headers)
        self.assertEqual(r.status_code, 403, r.text)
        r = client.post("/api/v1/invites", json={"role": "distributor"}, headers=headers)
        self.assertEqual(r.status_code, 403, r.text)

    def test_the_full_tree_is_unchanged_for_a_brand_without_the_setting(self):
        brand = self.make_brand(admin_login="email_code")
        headers = self.sign_in_by_code(self.admin_in(brand))
        r = self.create(headers, "dealer")
        self.assertEqual(r.status_code, 201, r.text)

    def test_the_rule_helper(self):
        brand = self.make_brand(hierarchy="admin_users")
        admin = self.admin_in(brand)
        table = {"manufacturer": ["distributor", "dealer", "customer"]}
        self.assertEqual(brand_service.assignable_roles(self.db, admin, table), ["customer"])
        plain = self.admin_in(self.make_brand(), "plain")
        self.assertEqual(brand_service.assignable_roles(self.db, plain, table), ["distributor", "dealer", "customer"])


class TestWebsiteLearnsTheRule(BrandBase):
    def mine(self, brand):
        headers = self.sign_in_by_code(self.admin_in(brand))
        r = client.get("/api/v1/brands/mine", headers=headers)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()["brand"]

    def test_the_rule_is_reported_to_the_website(self):
        self.assertEqual(self.mine(self.make_brand(admin_login="email_code", hierarchy="admin_users"))["hierarchy"], "admin_users")

    def test_a_brand_without_the_rule_reports_the_full_tree(self):
        self.assertEqual(self.mine(self.make_brand(admin_login="email_code"))["hierarchy"], "full")


if __name__ == "__main__":
    unittest.main()
