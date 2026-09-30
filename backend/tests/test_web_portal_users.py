"""Partner-portal user management and the endpoints that used to be open to anyone.

Every one of these was possible without signing in before: listing every user, creating a superadmin, reading the
metrics, posting readings for a pump that had no key. Runs against the local development database.
"""
import os
import sys
import unittest
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pyotp
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.models import AuditLog, Pump, User
from app.services.jwt_auth import sign_token
from test_web_portal_hardening import MfaBase  # noqa: E402  (the base class only: it has no tests of its own)

client = TestClient(app)


def _partner(base, role, tag, parent=None):
    """A partner account straight in the database, with TOTP on so the MFA gate is not what these tests are about."""
    u = base.make_user(role, tag)
    u = base.db.query(User).filter(User.id == u.id).one()
    u.hierarchy_path = f"{parent.hierarchy_path}/{u.id}" if parent else f"/SA/{u.id}"
    u.parent_user_id = parent.id if parent else None
    u.totp_secret, u.totp_enabled = pyotp.random_base32(), True
    base.db.commit()
    return u


def _h(user):
    token = sign_token({"sub": str(user.id), "role": user.role, "hierarchy_path": user.hierarchy_path, "session_ver": 1})
    return {"Authorization": f"Bearer {token}"}


def _verify_phone(phone: str, purpose: str = "registration") -> str:
    """The real two-step flow a client would do (send a code, confirm it) — using the dev_otp escape hatch
    the send route only offers when ENV=development, exactly like every other OTP flow's tests already do.
    Returns the ticket that POST /users / invite-redeem / reset-password now require.
    """
    sent = client.post("/api/v1/auth/verify-phone/send", json={"phone_number": phone, "purpose": purpose})
    assert sent.status_code == 200, sent.text
    code = sent.json()["dev_otp"]
    confirmed = client.post("/api/v1/auth/verify-phone/confirm", json={"phone_number": phone, "purpose": purpose, "code": code})
    assert confirmed.status_code == 200, confirmed.text
    return confirmed.json()["verification_token"]


class TestUsersRequireASession(MfaBase):
    def test_nothing_under_users_answers_without_a_token(self):
        some_id = str(uuid.uuid4())
        intruder = {"full_name": "Intruder", "phone_number": "9000000001", "role": "superadmin", "password": "Whatever-123"}
        calls = [
            client.get("/api/v1/users"), client.get("/api/v1/users/tree"), client.get(f"/api/v1/users/{some_id}"),
            client.post("/api/v1/users", json=intruder),
            client.put(f"/api/v1/users/{some_id}", json={"full_name": "x"}), client.delete(f"/api/v1/users/{some_id}"),
            client.get("/users"), client.get("/api/users/tree"),
        ]
        for r in calls:
            self.assertEqual(r.status_code, 401, f"{r.request.method} {r.request.url}")

    def test_a_farmer_cannot_use_them_either(self):
        farmer = self.make_user("customer", "farmer")
        for r in (client.get("/api/v1/users", headers=_h(farmer)), client.get("/api/v1/users/tree", headers=_h(farmer))):
            self.assertEqual(r.status_code, 403)

    def test_no_account_appears_from_an_unauthenticated_post(self):
        before = self.db.query(User).count()
        client.post("/api/v1/users", json={"full_name": "Intruder", "phone_number": "9000000002", "role": "superadmin", "password": "Whatever-123"})
        self.assertEqual(self.db.query(User).count(), before)


class TestUserManagementRules(MfaBase):
    def setUp(self):
        cls = type(self)
        if getattr(cls, "sa", None) is None:
            cls.sa = _partner(self, "superadmin", "root")
        self.dealer = _partner(self, "dealer", "d1", parent=self.sa)
        self.other_dealer = _partner(self, "dealer", "d10", parent=self.sa)

    def create(self, actor, **body):
        body.setdefault("full_name", "Someone")
        body.setdefault("phone_number", f"90{uuid.uuid4().int % 10**8:08d}")
        if "phone_verification_token" not in body:
            body["phone_verification_token"] = _verify_phone(body["phone_number"])
        r = client.post("/api/v1/users", json=body, headers=_h(actor))
        if r.status_code == 201:
            type(self).user_ids.append(uuid.UUID(r.json()["user"]["id"]))
        return r

    def test_a_dealer_creates_farmers_and_dealers_but_nothing_above_itself(self):
        ok = self.create(self.dealer, role="customer")
        self.assertEqual(ok.status_code, 201, ok.text)
        made = self.db.query(User).filter(User.id == ok.json()["user"]["id"]).one()
        self.assertTrue(made.hierarchy_path.startswith(self.dealer.hierarchy_path + "/"))
        self.assertIsNone(made.password_hash, "a farmer signs in with an SMS code and gets no default password")

        for role in ("superadmin", "manufacturer", "distributor"):
            self.assertEqual(self.create(self.dealer, role=role, password="Strong-Pass-1").status_code, 403, role)

    def test_a_partner_account_needs_a_real_password_and_there_is_no_default(self):
        for body in ({"role": "dealer"}, {"role": "dealer", "password": "short"}):
            r = self.create(self.dealer, **body)
            self.assertEqual(r.status_code, 422, r.text)
        self.assertEqual(self.create(self.dealer, role="dealer", password="Strong-Pass-1").status_code, 201)

    def test_the_platform_owner_role_cannot_be_created_at_all(self):
        self.assertEqual(self.create(self.sa, role="superadmin", password="Strong-Pass-1").status_code, 403)

    def test_every_node_lists_its_own_login_first_in_members(self):
        """The portal builds its account pickers (allocate, assign alert) from `members` and counts logins from it."""
        child = self.create(self.dealer, role="customer").json()["user"]["id"]
        staff = self.create(self.dealer, membership="staff", password="Strong-Pass-1").json()["user"]["id"]

        def walk(node):
            yield node
            for c in node["children"]:
                yield from walk(c)

        tree = client.get("/api/v1/users/tree", headers=_h(self.dealer)).json()["tree"]
        nodes = {n["id"]: n for root in tree for n in walk(root)}
        for user_id in (str(self.dealer.id), child):
            node = nodes[user_id]
            self.assertEqual(node["members"][0]["id"], user_id, "the node's own login comes first")
            self.assertNotIn("members", node["members"][0], "a member entry is flat: no nesting, no cycles")
        # A colleague sharing the dealer's unit is one of its logins, not a branch of its own.
        self.assertIn(staff, [m["id"] for m in nodes[str(self.dealer.id)]["members"]])
        self.assertNotIn(staff, nodes)

    def test_a_partner_sees_only_its_own_subtree_and_d1_does_not_cover_d10(self):
        child = self.create(self.dealer, role="customer").json()["user"]["id"]
        foreign = self.create(self.other_dealer, role="customer").json()["user"]["id"]

        visible = {u["id"] for u in client.get("/api/v1/users", headers=_h(self.dealer)).json()}
        self.assertIn(child, visible)
        self.assertNotIn(foreign, visible)
        self.assertNotIn(str(self.other_dealer.id), visible)

        self.assertEqual(client.get(f"/api/v1/users/{foreign}", headers=_h(self.dealer)).status_code, 404)
        self.assertEqual(client.get(f"/api/v1/users/{child}", headers=_h(self.dealer)).status_code, 200)

        def ids(node):
            yield node["id"]
            for c in node.get("children", []) + node.get("members", []):
                yield from ids(c)

        tree = client.get("/api/v1/users/tree", headers=_h(self.dealer)).json()["tree"]
        tree_ids = {i for root in tree for i in ids(root)}
        self.assertIn(child, tree_ids)
        self.assertNotIn(foreign, tree_ids)

        everything = {u["id"] for u in client.get("/api/v1/users", headers=_h(self.sa)).json()}
        self.assertTrue({child, foreign} <= everything, "the platform owner sees everyone")

    def test_a_parent_outside_the_callers_tree_is_refused(self):
        r = self.create(self.dealer, role="customer", parent_hierarchy_path=self.other_dealer.hierarchy_path)
        self.assertEqual(r.status_code, 404)
        r = self.create(self.dealer, role="customer", parent_user_id=str(self.other_dealer.id))
        self.assertEqual(r.status_code, 404)

    def test_a_colleague_joins_the_unit_and_does_not_start_a_new_branch(self):
        r = self.create(self.dealer, membership="staff", org_role="readonly", parent_user_id=str(self.dealer.id), password="Strong-Pass-1")
        self.assertEqual(r.status_code, 201, r.text)
        made = self.db.query(User).filter(User.id == r.json()["user"]["id"]).one()
        self.assertEqual((made.role, made.hierarchy_path, made.org_role), ("dealer", self.dealer.hierarchy_path, "readonly"))
        self.assertEqual(made.org_node_id, self.dealer.id)

    def test_a_used_phone_number_is_a_conflict_not_a_crash(self):
        phone = f"91{uuid.uuid4().int % 10**8:08d}"
        self.assertEqual(self.create(self.dealer, role="customer", phone_number=phone).status_code, 201)
        self.assertEqual(self.create(self.dealer, role="customer", phone_number=phone).status_code, 409)

    def test_suspending_ends_the_sessions_and_you_cannot_suspend_yourself(self):
        child = self.create(self.dealer, role="dealer", password="Strong-Pass-1").json()["user"]["id"]
        child_user = self.db.query(User).filter(User.id == child).one()
        self.assertEqual(client.get("/api/v1/auth/me", headers=_h(child_user)).status_code, 200)

        r = client.put(f"/api/v1/users/{child}", json={"account_status": "SUSPENDED", "device_quota": 5}, headers=_h(self.dealer))
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["user"]["account_status"], "SUSPENDED")
        self.assertIn(client.get("/api/v1/auth/me", headers=_h(child_user)).status_code, (401, 403))

        own = client.put(f"/api/v1/users/{self.dealer.id}", json={"account_status": "ACTIVE"}, headers=_h(self.dealer))
        self.assertEqual(own.status_code, 403)
        bad = client.put(f"/api/v1/users/{child}", json={"account_status": "DELETED"}, headers=_h(self.dealer))
        self.assertEqual(bad.status_code, 422)
        foreign = client.put(f"/api/v1/users/{self.other_dealer.id}", json={"full_name": "Hijacked"}, headers=_h(self.dealer))
        self.assertEqual(foreign.status_code, 404)

    def test_only_the_platform_owner_deletes_and_never_an_owner_of_devices(self):
        child = self.create(self.dealer, role="customer").json()["user"]["id"]
        self.assertEqual(client.delete(f"/api/v1/users/{child}", headers=_h(self.dealer)).status_code, 403)

        pump = Pump(id=f"PUMP-UM-{uuid.uuid4().hex[:8]}", name="Owned", supply_type="3-phase", hp_rating=5,
                    owner_user_id=uuid.UUID(child), hierarchy_path="/SA", status="STOPPED", lifecycle_state="ACTIVE")
        self.db.add(pump)
        self.db.commit()
        try:
            self.assertEqual(client.delete(f"/api/v1/users/{child}", headers=_h(self.sa)).status_code, 409)
        finally:
            self.db.delete(pump)
            self.db.commit()
        self.assertEqual(client.delete(f"/api/v1/users/{child}", headers=_h(self.sa)).status_code, 200)
        self.assertEqual(client.delete(f"/api/v1/users/{self.sa.id}", headers=_h(self.sa)).status_code, 403)

    def test_creation_is_audited(self):
        made = self.create(self.dealer, role="customer").json()["user"]["id"]
        rows = self.db.query(AuditLog).filter(AuditLog.entity_id == made, AuditLog.entity_type == "user").all()
        self.assertEqual([r.action for r in rows], ["USER_CREATED"])


class TestOperationalEndpointsAreNotOpen(MfaBase):
    def test_metrics_need_the_platform_owner_or_a_scrape_token_outside_development(self):
        sa = _partner(self, "superadmin", "m1")
        dealer = _partner(self, "dealer", "m2", parent=sa)
        old_env, old_token = settings.ENV, settings.METRICS_TOKEN
        try:
            settings.ENV = "production"
            settings.METRICS_TOKEN = ""
            self.assertEqual(client.get("/api/v1/system/metrics").status_code, 401)
            self.assertEqual(client.get("/api/v1/system/metrics", headers=_h(dealer)).status_code, 401)
            self.assertEqual(client.get("/api/v1/system/metrics", headers=_h(sa)).status_code, 200)

            settings.METRICS_TOKEN = "scrape-token-value"
            self.assertEqual(client.get("/api/v1/system/metrics", headers={"X-Metrics-Token": "wrong"}).status_code, 401)
            self.assertEqual(client.get("/api/v1/system/metrics", headers={"X-Metrics-Token": "scrape-token-value"}).status_code, 200)
            settings.ENV = "development"
            self.assertEqual(client.get("/api/v1/system/metrics").status_code, 401, "a set token closes it even in development")
        finally:
            settings.ENV, settings.METRICS_TOKEN = old_env, old_token

    def test_health_is_status_only_for_the_public_and_real_for_the_owner(self):
        sa = _partner(self, "superadmin", "h1")
        public = client.get("/api/v1/system/health").json()
        self.assertEqual(set(public), {"status", "timestamp"})
        full = client.get("/api/v1/system/health", headers=_h(sa)).json()
        self.assertIn("process", full)
        db_part = full["database"]
        self.assertGreater(db_part["pool_total"], 0)
        self.assertLessEqual(db_part["pool_idle"], db_part["pool_total"])
        self.assertIsNone(db_part["pool_waiting"], "not measurable, so not invented")

    def test_a_keyless_device_cannot_post_readings_outside_development(self):
        owner = self.make_user("customer", "kl-owner")
        pump = Pump(id=f"PUMP-KL-{uuid.uuid4().hex[:8]}", name="Keyless", supply_type="3-phase", hp_rating=5, owner_user_id=owner.id,
                    hierarchy_path="/SA", status="STOPPED", lifecycle_state="ACTIVE")
        self.db.add(pump)
        self.db.commit()
        body = {"dev_id": pump.id, "vl": [415, 412, 410], "mot": 1, "flt": 0}
        old = settings.ENV
        try:
            self.assertEqual(client.post("/api/v1/telemetry", json=body, headers={"X-Device-Id": pump.id}).status_code, 200)
            settings.ENV = "production"
            self.assertEqual(client.post("/api/v1/telemetry", json={**body, "seq": 1}, headers={"X-Device-Id": pump.id}).status_code, 401)
        finally:
            settings.ENV = old
            self.db.query(Pump).filter(Pump.id == pump.id).delete()
            self.db.commit()

    def test_the_provisioning_hook_needs_its_secret_outside_development(self):
        old_env, old_secret = settings.ENV, settings.PROVISIONING_HOOK_SECRET
        payload = {"parameters": {"SerialNumber": "NOPE"}}
        url = "/api/v1/batches/provisioning/pre-hook"
        try:
            settings.ENV = "production"
            settings.PROVISIONING_HOOK_SECRET = ""
            self.assertEqual(client.post(url, json=payload).status_code, 401)
            settings.PROVISIONING_HOOK_SECRET = "s3cret-hook-value"
            self.assertEqual(client.post(url, json=payload, headers={"X-Hook-Secret": "wrong"}).status_code, 401)
            ok = client.post(url, json=payload, headers={"X-Hook-Secret": "s3cret-hook-value"})
            self.assertEqual(ok.status_code, 200)
            self.assertFalse(ok.json()["allowProvisioning"])
        finally:
            settings.ENV, settings.PROVISIONING_HOOK_SECRET = old_env, old_secret


if __name__ == "__main__":
    unittest.main()
