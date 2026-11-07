"""A dealer registers a farmer on the website (name, address, phone, starter, pump capacity) and gets a one-time QR; the farmer scans it in
the app, types the registered number, and is in: no OTP.

Runs against the local development database; every row created here is removed again.
"""
import os
import sys
import unittest
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.phone import india_phone
from app.main import app
from app.models import AllocationLog, AuditLog, Pump, User
from app.models.farmer_claim import FarmerClaim
from app.services import farmer_claims
from test_auth_security_regressions import SignInBase

client = TestClient(app)


def digits():
    return f"9{uuid.uuid4().int % 10**9:09d}"


class TestIndiaPhone(unittest.TestCase):
    def test_every_way_of_writing_a_mobile_number_gives_one_form(self):
        for raw in ("98765 43210", "09876543210", "919876543210", "+91 98765-43210", "9876543210", "+919876543210"):
            self.assertEqual(india_phone(raw), "+919876543210", raw)

    def test_things_that_are_not_indian_mobile_numbers_are_refused(self):
        for raw in ("", "12345", "5876543210", "98765432", "abcdefghij", "+1 415 555 0100"):
            self.assertIsNone(india_phone(raw), raw)


class Base(SignInBase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.pump_ids = []

    @classmethod
    def tearDownClass(cls):
        try:
            cls.db.rollback()
            cls.db.execute(text("SET app.bypass_rls = 'on';"))
            farmer_ids = [r[0] for r in cls.db.query(User.id).filter(User.phone.in_(cls.phones)).all()] if cls.phones else []
            cls.user_ids.extend(farmer_ids)
            if cls.pump_ids:
                cls.db.query(AllocationLog).filter(AllocationLog.pump_id.in_(cls.pump_ids)).delete(synchronize_session=False)
                cls.db.query(AuditLog).filter(AuditLog.entity_id.in_(cls.pump_ids)).delete(synchronize_session=False)
                cls.db.query(Pump).filter(Pump.id.in_(cls.pump_ids)).delete(synchronize_session=False)
            if cls.user_ids:
                cls.db.query(AuditLog).filter(AuditLog.entity_id.in_([str(i) for i in cls.user_ids])).delete(synchronize_session=False)
                cls.db.query(AllocationLog).filter(AllocationLog.to_user_id.in_(cls.user_ids)).delete(synchronize_session=False)
                cls.db.query(FarmerClaim).filter(FarmerClaim.user_id.in_(cls.user_ids)).delete(synchronize_session=False)
            cls.db.commit()
        finally:
            super().tearDownClass()

    def dealer(self, tag="dealer"):
        """The Ajanta admin (the manufacturer's own account): the only login that registers farmers. (Kept under its old name.)"""
        return self.make_user("manufacturer", tag)

    def stock(self, dealer, state="IN_STOCK"):
        pid = f"FR{self.sfx}-{uuid.uuid4().hex[:6]}".upper()
        self.db.add(Pump(id=pid, name="Starter in stock", owner_user_id=dealer.id, hierarchy_path=dealer.hierarchy_path,
                         lifecycle_state=state, hp_rating=5))
        self.db.commit()
        type(self).pump_ids.append(pid)
        return pid

    def headers(self, user):
        return self.bearer(self.login(user).json())

    def form(self, starter, phone=None, **over):
        phone = phone or digits()
        type(self).phones.append(india_phone(phone))
        body = {"full_name": "Ramesh Patil", "address": "Plot 4, Hadapsar, Pune", "phone": phone, "starter_id": starter, "capacity_hp": 7.5}
        body.update(over)
        return body

    def register(self, dealer, body):
        return client.post("/api/v1/farmers", json=body, headers=self.headers(dealer))


class TestRegisterFarmer(Base):
    def test_one_form_makes_the_farmer_gives_them_the_starter_and_returns_a_qr(self):
        dealer = self.dealer()
        starter = self.stock(dealer)
        r = self.register(dealer, self.form(starter, phone="98765 43210" if False else None))
        self.assertEqual(r.status_code, 201, r.text)
        body = r.json()
        self.assertEqual(body["farmer"]["full_name"], "Ramesh Patil")
        self.assertEqual(body["farmer"]["address"], "Plot 4, Hadapsar, Pune")
        self.assertTrue(body["farmer"]["phone_number"].startswith("+91"))
        self.assertEqual(body["pump"]["id"], starter)
        self.assertEqual(body["pump"]["hp_rating"], 7.5)
        self.assertEqual(body["qr"]["state"], "PENDING")
        self.assertTrue(body["qr"]["payload"].startswith(farmer_claims.CLAIM_PREFIX))
        # the farmer owns the starter and sits under the dealer
        self.db.expire_all()
        pump = self.db.query(Pump).filter(Pump.id == starter).one()
        farmer = self.db.query(User).filter(User.id == pump.owner_user_id).one()
        self.assertEqual(farmer.role, "customer")
        self.assertIsNone(farmer.password_hash)
        self.assertTrue(farmer.hierarchy_path.startswith(dealer.hierarchy_path + "/"))
        self.assertEqual(pump.hierarchy_path, farmer.hierarchy_path)
        self.assertEqual(float(pump.hp_rating), 7.5)

    def test_the_qr_secret_is_never_stored_only_its_hash(self):
        dealer = self.dealer()
        r = self.register(dealer, self.form(self.stock(dealer)))
        token = farmer_claims.token_from_payload(r.json()["qr"]["payload"])
        row = self.db.query(FarmerClaim).filter(FarmerClaim.user_id == uuid.UUID(r.json()["farmer"]["id"])).one()
        self.assertNotEqual(row.token_hash, token)
        self.assertEqual(row.token_hash, farmer_claims.hash_token(token))

    def test_a_starter_that_is_not_in_the_dealers_stock_is_refused(self):
        dealer, other = self.dealer("a"), self.dealer("b")
        theirs = self.stock(other)
        r = self.register(dealer, self.form(theirs))
        self.assertEqual(r.status_code, 404, r.text)
        self.assertEqual(self.register(dealer, self.form("NO-SUCH-STARTER")).status_code, 404)

    def test_a_starter_already_given_to_a_farmer_cannot_be_given_again(self):
        dealer = self.dealer()
        starter = self.stock(dealer)
        self.assertEqual(self.register(dealer, self.form(starter)).status_code, 201)
        again = self.register(dealer, self.form(starter))
        self.assertEqual(again.status_code, 409, again.text)

    def test_an_installed_starter_is_not_stock(self):
        dealer = self.dealer()
        r = self.register(dealer, self.form(self.stock(dealer, state="ACTIVE")))
        self.assertEqual(r.status_code, 409, r.text)

    def test_the_same_mobile_number_cannot_be_registered_twice(self):
        dealer = self.dealer()
        phone = digits()
        self.assertEqual(self.register(dealer, self.form(self.stock(dealer), phone=phone)).status_code, 201)
        second = self.register(dealer, self.form(self.stock(dealer), phone=phone))
        self.assertEqual(second.status_code, 409, second.text)

    def test_a_bad_number_or_capacity_is_refused_and_nothing_is_created(self):
        dealer = self.dealer()
        starter = self.stock(dealer)
        for over in ({"phone": "12345"}, {"capacity_hp": 0}, {"capacity_hp": -3}, {"full_name": "R"}, {"address": ""}):
            r = self.register(dealer, self.form(starter, **over))
            self.assertEqual(r.status_code, 422, (over, r.text))
        self.db.expire_all()
        self.assertEqual(self.db.query(Pump).filter(Pump.id == starter).one().owner_user_id, dealer.id)

    def test_only_the_ajanta_admin_registers_farmers_not_a_dealer_a_distributor_or_the_super_admin(self):
        owner = self.dealer()
        starter = self.stock(owner)
        for role in ("dealer", "distributor", "superadmin", "support"):
            other = self.make_user(role, f"no-{role}")
            r = client.post("/api/v1/farmers", json=self.form(starter), headers=self.headers(other))
            self.assertEqual(r.status_code, 403, (role, r.text))
        self.assertEqual(self.register(owner, self.form(starter)).status_code, 201)

    def test_a_farmer_cannot_register_farmers(self):
        farmer = self.make_user("customer", "nosy")
        r = client.post("/api/v1/farmers", json=self.form("ANY-STARTER"), headers=self.headers(farmer))
        self.assertEqual(r.status_code, 403, r.text)


class TestScanTheQr(Base):
    def registered(self):
        dealer = self.dealer()
        phone = digits()
        r = self.register(dealer, self.form(self.stock(dealer), phone=phone))
        self.assertEqual(r.status_code, 201, r.text)
        return dealer, phone, r.json()

    def claim(self, payload, phone, **extra):
        return client.post("/api/v1/auth/claim", json={"qr": payload, "phone": phone, **extra})

    def test_scanning_the_qr_and_typing_the_registered_number_signs_the_farmer_in_without_an_otp(self):
        _, phone, made = self.registered()
        r = self.claim(made["qr"]["payload"], phone, app_install_id="install-1")
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertTrue(body["access_token"])
        self.assertEqual(body["user"]["id"], made["farmer"]["id"])
        self.assertFalse(body["is_new_user"])
        # the signed-in farmer sees exactly their pump
        pumps = client.get("/api/v1/pumps", headers={"Authorization": f"Bearer {body['access_token']}"}).json()["pumps"]
        self.assertEqual([p["id"] for p in pumps], [made["pump"]["id"]])

    def test_the_number_can_be_typed_in_any_usual_way(self):
        _, phone, made = self.registered()
        r = self.claim(made["qr"]["payload"], f"+91 {phone[:5]} {phone[5:]}")
        self.assertEqual(r.status_code, 200, r.text)

    def test_a_qr_works_only_once(self):
        _, phone, made = self.registered()
        self.assertEqual(self.claim(made["qr"]["payload"], phone).status_code, 200)
        again = self.claim(made["qr"]["payload"], phone)
        self.assertEqual(again.status_code, 400, again.text)

    def test_the_wrong_number_is_refused_and_five_wrong_numbers_burn_the_qr(self):
        _, phone, made = self.registered()
        for i in range(4):
            r = self.claim(made["qr"]["payload"], digits())
            self.assertEqual(r.status_code, 400, r.text)
            self.assertNotIn("blocked", r.json()["detail"])
        fifth = self.claim(made["qr"]["payload"], digits())
        self.assertEqual(fifth.status_code, 400)
        self.assertIn("blocked", fifth.json()["detail"])
        # even the right number does not work now
        self.assertEqual(self.claim(made["qr"]["payload"], phone).status_code, 400)

    def test_a_made_up_or_foreign_qr_is_refused(self):
        _, phone, _ = self.registered()
        for payload in ("AGP-CLAIM:" + "x" * 32, "https://example.com/not-ours-at-all", "AGP-CLAIM:short", "random text that is long enough"):
            # 400 (not one of ours / not valid) or 422 (too short to be a QR at all): either way, no sign-in
            self.assertIn(self.claim(payload, phone).status_code, (400, 422), payload)

    def test_an_expired_qr_is_refused(self):
        _, phone, made = self.registered()
        row = self.db.query(FarmerClaim).filter(FarmerClaim.user_id == uuid.UUID(made["farmer"]["id"])).one()
        row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        self.db.commit()
        self.assertEqual(self.claim(made["qr"]["payload"], phone).status_code, 400)

    def test_a_new_qr_stops_the_old_one_and_works_itself(self):
        dealer, phone, made = self.registered()
        fresh = client.post(f"/api/v1/farmers/{made['farmer']['id']}/qr", headers=self.headers(dealer))
        self.assertEqual(fresh.status_code, 200, fresh.text)
        self.assertEqual(self.claim(made["qr"]["payload"], phone).status_code, 400, "the old QR is revoked")
        self.assertEqual(self.claim(fresh.json()["qr"]["payload"], phone).status_code, 200)

    def test_only_the_dealer_above_a_farmer_can_make_a_new_qr(self):
        dealer, _, made = self.registered()
        stranger = self.dealer("stranger")
        r = client.post(f"/api/v1/farmers/{made['farmer']['id']}/qr", headers=self.headers(stranger))
        self.assertEqual(r.status_code, 404, r.text)

    def test_the_list_shows_only_my_farmers_and_whether_the_qr_was_scanned(self):
        dealer, phone, made = self.registered()
        other_dealer = self.dealer("other")
        other = self.register(other_dealer, self.form(self.stock(other_dealer)))
        self.assertEqual(other.status_code, 201)
        before = client.get("/api/v1/farmers", headers=self.headers(dealer)).json()["farmers"]
        self.assertEqual([f["id"] for f in before], [made["farmer"]["id"]])
        self.assertEqual(before[0]["qr"]["state"], "PENDING")
        self.assertEqual(before[0]["pumps"][0]["id"], made["pump"]["id"])
        self.assertNotIn("payload", before[0]["qr"], "the QR secret cannot be read back")
        self.claim(made["qr"]["payload"], phone)
        after = client.get("/api/v1/farmers", headers=self.headers(dealer)).json()["farmers"]
        self.assertEqual(after[0]["qr"]["state"], "CLAIMED")


if __name__ == "__main__":
    unittest.main()
