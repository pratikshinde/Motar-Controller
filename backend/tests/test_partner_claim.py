"""Distributors and dealers sign up the way farmers do: the person above them registers a mobile number and hands over a one-time QR;
they open it, type the number and choose a password. No OTP, no email. Runs against the local development database.
"""
import os
import sys
import unittest
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient

from app.main import app
from app.models import User
from app.models.farmer_claim import FarmerClaim
from test_web_portal_users import _h, _partner  # noqa: E402
from test_web_portal_hardening import MfaBase  # noqa: E402  (the base class only)

client = TestClient(app)
PASSWORD = "My-Own-Pass-1"


def _digits():
    return f"90{uuid.uuid4().int % 10**8:08d}"


class PartnerClaimBase(MfaBase):
    def setUp(self):
        cls = type(self)
        if getattr(cls, "sa", None) is None:
            cls.sa = _partner(self, "superadmin", "claim-root")
        self.admin = _partner(self, "manufacturer", "claim-admin", parent=self.sa)
        self.dist = _partner(self, "distributor", "claim-dist", parent=self.admin)

    def add(self, actor, role="dealer", phone=None, **extra):
        phone = phone or _digits()
        r = client.post("/api/v1/users", headers=_h(actor), json={"full_name": "New Partner", "phone_number": phone, "role": role, **extra})
        if r.status_code == 201:
            type(self).user_ids.append(uuid.UUID(r.json()["user"]["id"]))
        return r, phone

    def claim(self, qr, phone, password=PASSWORD):
        return client.post("/api/v1/auth/partner-claim", json={"qr": qr, "phone": phone, "password": password})

    def made(self, actor=None, role="dealer"):
        r, phone = self.add(actor or self.dist, role)
        self.assertEqual(r.status_code, 201, r.text)
        return r.json()["user"]["id"], phone, r.json()["claim"]


class TestAddingAPartnerByQr(PartnerClaimBase):
    def test_a_distributor_or_dealer_needs_only_a_name_and_a_number_and_gets_a_qr(self):
        for actor, role in ((self.admin, "distributor"), (self.admin, "dealer"), (self.dist, "dealer")):
            r, _ = self.add(actor, role)
            self.assertEqual(r.status_code, 201, (role, r.text))
            claim = r.json()["claim"]
            self.assertTrue(claim["qr"].startswith("AGP-CLAIM:"))
            self.assertTrue(claim["token"] and claim["expires_at"])
            made = self.db.query(User).filter(User.id == r.json()["user"]["id"]).one()
            self.assertIsNone(made.password_hash, "nobody sets their password for them")
            self.assertIsNone(made.email)
            self.assertFalse(made.is_verified, "no code was sent, so the number is not marked as verified")

    def test_the_number_must_be_a_real_ten_digit_mobile_number_and_unused(self):
        self.assertEqual(self.add(self.dist, "dealer", phone="12345")[0].status_code, 422)
        r, phone = self.add(self.dist, "dealer")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(self.add(self.dist, "dealer", phone=phone)[0].status_code, 409)

    def test_it_is_not_a_way_to_get_a_farmer_or_an_account_above_you(self):
        self.assertEqual(self.add(self.dist, "distributor")[0].status_code, 403)
        self.assertEqual(self.add(self.dist, "manufacturer")[0].status_code, 403)

    def test_an_admin_still_needs_an_email_and_a_password(self):
        r, _ = self.add(self.sa, "manufacturer", password="Strong-Pass-1", brand="ajanta")
        self.assertEqual(r.status_code, 422)
        self.assertIn("email", r.json()["detail"])


class TestOpeningTheQr(PartnerClaimBase):
    def test_the_qr_the_number_and_a_password_open_the_account_and_sign_in(self):
        uid, phone, claim = self.made()
        r = self.claim(claim["qr"], phone)
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertTrue(body["access_token"] and body["refresh_token"])
        self.assertEqual(client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"}).status_code, 200)
        # afterwards: the mobile number and that password
        login = client.post("/api/v1/auth/login-password", json={"phone_number": phone, "password": PASSWORD})
        self.assertEqual(login.status_code, 200, login.text)
        self.assertEqual(client.post("/api/v1/auth/login-password", json={"phone_number": phone, "password": "Wrong-Pass-9"}).status_code, 401)

    def test_a_qr_works_once(self):
        _, phone, claim = self.made()
        self.assertEqual(self.claim(claim["qr"], phone).status_code, 200)
        again = self.claim(claim["qr"], phone, "Another-Pass-2")
        self.assertEqual(again.status_code, 400)
        self.assertEqual(client.post("/api/v1/auth/login-password", json={"phone_number": phone, "password": PASSWORD}).status_code, 200,
                         "the second try changed nothing")

    def test_a_wrong_number_is_refused_and_five_burn_the_qr(self):
        _, phone, claim = self.made()
        for _ in range(4):
            r = self.claim(claim["qr"], _digits())
            self.assertEqual(r.status_code, 400)
            self.assertNotIn("blocked", r.json()["detail"])
        burned = self.claim(claim["qr"], _digits())
        self.assertEqual(burned.status_code, 400)
        self.assertIn("blocked", burned.json()["detail"])
        self.assertEqual(self.claim(claim["qr"], phone).status_code, 400, "even the right number is refused once it is burned")

    def test_a_short_password_is_refused_and_the_qr_still_works(self):
        _, phone, claim = self.made()
        self.assertEqual(self.claim(claim["qr"], phone, "short").status_code, 422)
        self.assertEqual(self.claim(claim["qr"], phone).status_code, 200)

    def test_the_number_may_be_typed_in_any_usual_format(self):
        _, phone, claim = self.made()
        self.assertEqual(self.claim(claim["qr"], f"+91 {phone[:5]}-{phone[5:]}").status_code, 200)

    def test_rubbish_and_other_peoples_qr_are_not_accepted(self):
        self.assertEqual(self.claim("not-a-qr-code-at-all-really", _digits()).status_code, 400)
        self.assertEqual(self.claim("AGP-CLAIM:" + "x" * 32, _digits()).status_code, 400)
        # a farmer's QR belongs to the app: it does not open a website login
        farmer = self.make_user("customer", "claim-farmer")
        from app.services import farmer_claims
        claim, token = farmer_claims.issue_claim(self.db, farmer.id, self.dist.id)
        self.db.commit()
        type(self).extra_claim_ids = getattr(type(self), "extra_claim_ids", []) + [claim.id]
        self.assertEqual(self.claim(farmer_claims.payload_for(token), farmer.phone or farmer.phone_number).status_code, 400)

    def test_a_stopped_account_cannot_open_its_qr(self):
        uid, phone, claim = self.made()
        self.db.query(User).filter(User.id == uid).update({"account_status": "SUSPENDED"})
        self.db.commit()
        self.assertEqual(self.claim(claim["qr"], phone).status_code, 403)


class TestANewQr(PartnerClaimBase):
    def new_qr(self, actor, uid):
        return client.post(f"/api/v1/users/{uid}/qr", headers=_h(actor))

    def test_the_one_above_makes_a_new_qr_and_the_old_one_stops_working(self):
        uid, phone, first = self.made()
        r = self.new_qr(self.dist, uid)
        self.assertEqual(r.status_code, 200, r.text)
        second = r.json()["claim"]
        self.assertNotEqual(first["token"], second["token"])
        self.assertEqual(self.claim(first["qr"], phone).status_code, 400)
        self.assertEqual(self.claim(second["qr"], phone).status_code, 200)

    def test_a_lost_password_is_replaced_by_a_new_qr_and_the_old_sessions_end(self):
        uid, phone, claim = self.made()
        signed_in = self.claim(claim["qr"], phone).json()
        again = self.new_qr(self.dist, uid).json()["claim"]
        reset = self.claim(again["qr"], phone, "Brand-New-Pass-3")
        self.assertEqual(reset.status_code, 200, reset.text)
        self.assertEqual(client.post("/api/v1/auth/login-password", json={"phone_number": phone, "password": PASSWORD}).status_code, 401,
                         "the old password no longer works")
        self.assertEqual(client.post("/api/v1/auth/login-password", json={"phone_number": phone, "password": "Brand-New-Pass-3"}).status_code, 200)
        refreshed = client.post("/api/v1/auth/refresh", json={"refresh_token": signed_in["refresh_token"]})
        self.assertEqual(refreshed.status_code, 401, "the session from before the reset is over")

    def test_only_someone_above_can_make_it_and_only_for_a_distributor_or_dealer(self):
        uid, _, _ = self.made()
        stranger = _partner(self, "distributor", "claim-stranger", parent=self.admin)
        self.assertEqual(self.new_qr(stranger, uid).status_code, 404, "another distributor's dealer is out of reach")
        self.assertEqual(self.new_qr(self.admin, uid).status_code, 200, "the admin above may")
        dealer = self.db.query(User).filter(User.id == uid).one()
        self.assertEqual(self.new_qr(dealer, str(self.dist.id)).status_code, 404, "nobody makes one for the person above")
        self.assertEqual(self.new_qr(self.dist, str(self.dist.id)).status_code, 403, "nor for yourself")
        farmer = _partner(self, "customer", "claim-farmer2", parent=self.dist)
        self.assertEqual(self.new_qr(self.dist, str(farmer.id)).status_code, 403, "a farmer's QR is made on the Farmers page")

    def test_the_team_list_says_who_has_not_signed_in_yet(self):
        uid, phone, claim = self.made()

        tree = client.get("/api/v1/users/tree", headers=_h(self.dist)).json()["tree"]

        def find(nodes):
            for n in nodes:
                if n["id"] == uid:
                    return n
                found = find(n.get("children", []))
                if found:
                    return found

        self.assertIs(find(tree)["has_signed_in"], False)
        self.claim(claim["qr"], phone)
        tree = client.get("/api/v1/users/tree", headers=_h(self.dist)).json()["tree"]
        self.assertIs(find(tree)["has_signed_in"], True)


if __name__ == "__main__":
    unittest.main()
